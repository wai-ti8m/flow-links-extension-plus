import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

import FlowLink from './types';
import config from './config';

const {
  projectID,
  extensionID,
  location,
  iosBundleID,
  iosTeamID,
  iosAppStoreID,
  androidBundleID,
  androidSHAs,
  androidScheme,
  subdomain,
} = config;

// Initialize Express app
const app = express();

// Initialize Firebase Admin SDK
admin.initializeApp();

// Set up Firebase Cloud Functions
exports.api = functions.https.onRequest(app);

// FlowLinks domain name
const hostname = `${subdomain}.web.app`;

// Initializate extension
exports.initialize = functions.tasks.taskQueue().onDispatch(async () => {
  const { getExtensions } = await import('firebase-admin/extensions');
  const { FirebaseService } = await import('./firebase-service');

  try {
    // Initialize Firestore
    const db = admin.firestore();
    const collection = db.collection('_flowlinks_');

    // Initialize Firebase Service
    const firebaseService = new FirebaseService(projectID);
    await firebaseService.init();

    // Create a new website
    const siteID = await firebaseService.createNewWebsite(subdomain);

    // Specify website config
    const configPayload = {
      config: {
        appAssociation: 'NONE',
        rewrites: [
          {
            glob: '**',
            function: `ext-${extensionID}-api`,
            functionRegion: location,
          },
        ],
      },
    };

    // Get the new version ID
    const versionID = await firebaseService.createNewVersion(
      siteID,
      configPayload,
    );

    // Finalize version
    await firebaseService.finalizeVersion(siteID, versionID);

    // Deploy to hosting
    await firebaseService.deployVersion(siteID, versionID);

    // Add a sample flow link
    await collection.add({
      path: '/welcome',
      redirectToStore: false,
      redirectUrl: '',
      og: {
        title: { en:'Welcome to FlowLinks',  },
        description: { en:'Time to set them up!',  },
        image: { en:`https://${siteID}.web.app/images/thumb.jpg`,  },
      }
    });

    // Cold start the instance
    await axios.get(`https://${siteID}.web.app/welcome`);

    // Finalize extension initialization
    await getExtensions()
      .runtime()
      .setProcessingState('PROCESSING_COMPLETE', `Initialization is complete`);
  } catch (error) {
    const errorMessage = error === Error ? (error as Error).message : error;
    functions.logger.error('Initialization error:', errorMessage);

    await getExtensions()
      .runtime()
      .setProcessingState(
        'PROCESSING_FAILED',
        `Initialization failed. ${errorMessage}`,
      );
  }
});

// Error-handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    functions.logger.error('Error:', err);
    res.status(500).send('Internal Server Error');
  },
);

// iOS Association
app.get('/.well-known/apple-app-site-association', async (req, res) => {
  const applicationID = `${iosTeamID}.${iosBundleID}`;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.write(
    JSON.stringify({
      applinks: {
        apps: [],
        details: [
          {
            appID: applicationID,
            paths: ['*'],
          },
        ],
      },
      webcredentials: {
        apps: [applicationID],
      },
    }),
  );
  res.end();
});

// Android Association
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.write(
    JSON.stringify([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: androidBundleID,
          sha256_cert_fingerprints: androidSHAs,
        },
      },
    ]),
  );
  res.end();
});

// Host assets
app.use('/images', express.static(path.join(__dirname, './assets/images')));

// Handle all other routes
app.get('*', async (req: express.Request<{ lng: string }, any, any, any, Record<string, any>>, res, next) => {
  try {
    // Get Firestore instance
    const db = admin.firestore();

    const collection = db.collection('_flowlinks_');

    // Parse link data
    const urlObject = new URL(req.url, 'https://flowlinks');
    const linkPath = urlObject.pathname;

    // Fetch link document
    const snapshotQuery = collection.where('path', '==', linkPath).limit(1);
    const linkSnapshot = await snapshotQuery.get();

    const linkFound = linkSnapshot.docs.length !== 0;

    // If not found, return 404
    if (!linkFound) {
      return res.status(404).send(getNotFoundResponse());
    }

    const flowLink = linkSnapshot.docs[0].data() as FlowLink;

    const lang = req.params.lng || 'de';

    const source = await getFlowLinkResponse(flowLink, lang);

    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(source);
  } catch (error) {
    functions.logger.error('Error processing FlowLink: ', error);
    return res.status(500).send('Internal Server Error');
  }
});

function getNotFoundResponse(): string {
  // Gather metadata
  const thumbnail = `https://${hostname}/images/404-thumb.jpg`;
  const notFoundImage = `https://${hostname}/images/not-found.svg`;
  const flPoweredImage = `https://${hostname}/images/fl-powered.svg`;
  const backgroundImage = `https://${hostname}/images/background.png`;

  const templatePath = path.join(__dirname, './assets/html/404.html');
  const source = fs
    .readFileSync(templatePath, { encoding: 'utf-8' })
    .replaceAll('{{thumbnail}}', thumbnail)
    .replaceAll('{{notFoundImage}}', notFoundImage)
    .replaceAll('{{backgroundImage}}', backgroundImage)
    .replaceAll('{{flPoweredImage}}', flPoweredImage);

  return source;
}

async function getFlowLinkResponse(flowLink: FlowLink, lang: string): Promise<string> {
  // Gather metadata
  const og = flowLink.og || {};
  const title = (og.title || {})[lang] || '';
  const description = (og.description || {})[lang] || '';
  const image = (og.image || {})[lang] || '';

  functions.logger.debug(`
    lang = ${lang}
    title = ${title},
    description = ${description}
  `);

  const redirectToStore = flowLink.redirectToStore || false;
  const redirectUrl = flowLink.redirectUrl || '';
  const expires = flowLink.expires;

  if (expires && expires.toMillis() < Date.now()) {
    return ''; // Return nothing if the timestamp is in the past
  }

  const statusImage = `https://${hostname}/images/status.svg`;
  const flPoweredImage = `https://${hostname}/images/fl-powered.svg`;
  const backgroundImage = `https://${hostname}/images/background.png`;

  // Get iOS AppStore appID
  let appStoreID = '';
  if (redirectToStore) {
    appStoreID = iosAppStoreID;
  }

  const templatePath = path.join(__dirname, './assets/html/index.html');
  const source = fs
    .readFileSync(templatePath, { encoding: 'utf-8' })
    .replaceAll('{{title}}', title)
    .replaceAll('{{description}}', description)
    .replaceAll('{{appStoreID}}', appStoreID)
    .replaceAll('{{androidBundleID}}', androidBundleID)
    .replaceAll('{{androidScheme}}', (androidScheme ?? false).toString())
    .replaceAll('{{redirectToStore}}', redirectToStore.toString())
    .replaceAll('{{redirectUrl}}', redirectUrl)
    .replaceAll('{{thumbnail}}', image)
    .replaceAll('{{statusImage}}', statusImage)
    .replaceAll('{{backgroundImage}}', backgroundImage)
    .replaceAll('{{flPoweredImage}}', flPoweredImage);

    functions.logger.debug('html', source);

  return source;
}
