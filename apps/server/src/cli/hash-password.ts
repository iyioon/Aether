import { hashPassword } from "../auth/password.js";

const password = process.argv[2] ?? process.env.AETHER_PASSWORD;

if (!password) {
  console.error(
    "Usage: npm run hash-password -w @aether/server -- \"your password\""
  );
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);
