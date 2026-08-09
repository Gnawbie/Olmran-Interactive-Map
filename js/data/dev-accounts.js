// Dev-mode login accounts. Passwords are never stored in plaintext — each
// entry holds a random salt plus a PBKDF2-HMAC-SHA256 hash (200,000
// iterations), computed client-side via the browser's Web Crypto API on
// login and compared against the stored hash.
//
// This is a static site with no backend, and this repo is public, so treat
// this as a casual deterrent (keeps random visitors out of the dev tools),
// not real account security — a determined attacker could still brute-force
// a weak password offline, just far more slowly than a plain hash would
// allow. Don't reuse an important password for an account here.
//
// The "main" role account cannot be removed and can add/remove other
// accounts from the dev login screen once logged in.
const DEV_ACCOUNTS = [
  {
    username: "Gnawbie",
    salt: "4a3996bd34fd8f6b0470593dd5533b12",
    hash: "cd9e6e3322ff6f8023f76f31e0c7537ba4ca3cbc3b2874fcaf6c598022a174d3",
    iterations: 200000,
    role: "main"
  }
];
