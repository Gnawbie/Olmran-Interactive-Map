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
    salt: "252d36b54edb5f450e19a8a91e602b9a",
    hash: "9fa6f42af76dc23880ae7a07d10c4cff6849fca783fc89b2cc7eaa11c1d71627",
    iterations: 200000,
    role: "main"
  }
];
