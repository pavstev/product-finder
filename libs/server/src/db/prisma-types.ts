// The Prisma names that the ratings code needs. It lives here so only the db folder imports the generated client.
// Do not import client.ts from ratings: client.ts re-exports ratings, which would be a cycle.
export { Prisma } from './generated/client.js';
