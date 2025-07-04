import { Timestamp } from 'firebase-admin/firestore';

export default interface FlowLink {
  id?: string;
  path?: string;
  redirectToStore?: boolean;
  redirectUrl?: string;
  expires?: Timestamp;
  androidSchema?: string;
  og: Record<'title'| 'description'| 'image', Record<string, string>>;
}
