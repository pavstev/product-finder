// Load .env from the working directory if it exists. Real environment variables win.
// Import this first in every entry point.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
