// Queue settings. See docs/queue-backends.md for the interface every backend implements and how to add one.

// Which environment this copy of the app runs in. Set it here only: no URL or page can change it.
//   'product'  the exhibition (default)
//   'dev'      testing on one PC / the venue Wi-Fi with server/server.mjs (npm start, start-lan.bat)
export const ENVIRONMENT = 'product';

// Each environment names its backend ('firebase' | 'local' | any adapter in js/queue/index.js) and that
// backend's settings. registerUrl: the phone page the QR code points to (null = the backend's default:
// local → the server's LAN/localhost address, Firebase → https://<projectId>.web.app/register/).
export const ENVIRONMENTS = {
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
export const ENV = ENVIRONMENTS[ENVIRONMENT];

// Minutes one visitor's turn takes, used only for the "about N min" estimate on the phone.
// Placeholder: the real turn length is still under discussion.
export const TURN_MINUTES = 5;
