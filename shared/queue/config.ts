// Queue settings. See docs/queue-backends.md for the interface every backend implements and how to add one.
import type { EnvSettings } from './types.ts';

// Which environment this build runs in. It is fixed when the pages are built (scripts/build.ts):
//   npm run build      → 'product'  the exhibition (default)
//   npm run build:dev  → 'dev'      testing on one PC / the venue Wi-Fi with the reception server's local queue
// No URL or page can change it. (Outside a build, e.g. in the server, it reads as 'product'.)
export const ENVIRONMENT: string = typeof __SPACELINE_ENV__ !== 'undefined' ? __SPACELINE_ENV__ : 'product';

// Each environment names its backend ('firebase' | 'local' | any adapter in shared/queue/index.ts) and that
// backend's settings. registerUrl: the phone page the QR code points to (null = the backend's default:
// local → the server's LAN/localhost address, Firebase → https://<projectId>.web.app/register/).
export const ENVIRONMENTS: Record<string, EnvSettings> = {
  product: {
    backend: 'firebase',
    // Firebase web app config from the Firebase console (not a secret). See firebase/README-firebase.md.
    firebase: {
      apiKey: "AIzaSyANRPX-fsITqdyz5xKwxRDiqJFUpKfZVvU",
      authDomain: "space-line-54818.firebaseapp.com",
      projectId: "space-line-54818",
      storageBucket: "space-line-54818.firebasestorage.app",
      messagingSenderId: "101930717309",
      appId: "1:101930717309:web:ab0f575f9b60a30b426114",
      measurementId: "G-5NSXWJN40E"
    },
    // how staff can sign in: 'google' and/or 'password' (email + password). Enable the same providers in
    // Firebase console → Authentication → Sign-in method. Staff emails must be in meta/operators and verified.
    staffSignIn: ['google', 'password'],
    registerUrl: null,
  },
  dev: {
    backend: 'local',
    registerUrl: null,
  },
};

// the settings of the environment above
export const ENV: EnvSettings | undefined = ENVIRONMENTS[ENVIRONMENT];

// Minutes one visitor's turn takes, used only for the "about N min" estimate on the phone.
// Placeholder: the real turn length is still under discussion.
export const TURN_MINUTES = 5;
