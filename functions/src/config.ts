export interface Config {
  projectID: string;
  extensionID: string;
  location: string;
  iosBundleID: string;
  iosTeamID: string;
  iosAppStoreID: string;
  androidBundleID: string;
  androidSHAs?: string[];
  androidScheme?: string;
  domainPostfix: string;
}

const config: Config = {
  projectID: process.env.PROJECT_ID || '',
  extensionID: process.env.EXT_INSTANCE_ID || '',
  location: process.env.LOCATION || 'us-west1',
  iosBundleID: process.env.IOS_BUNDLE_ID || '',
  iosTeamID: process.env.IOS_TEAM_ID || '',
  iosAppStoreID: process.env.IOS_APPSTORE_ID || '',
  androidBundleID: process.env.ANDROID_BUNDLE_ID || '',
  androidSHAs: (process.env.ANDROID_SHAS || '').split(',').map(sha => sha.trim()),
  androidScheme: process.env.ANDROID_SCHEME || '',
  domainPostfix: process.env.DOMAIN_POSTFIX || 'flowlinks',
};

export default config;
