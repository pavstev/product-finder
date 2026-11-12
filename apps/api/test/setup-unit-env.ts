// Runs before each unit spec: AppModule validates the config when it is imported, and preview mode never connects.
process.env.DATABASE_URL = 'postgresql://openapi.invalid:5432/openapi';
process.env.LOG_LEVEL = 'silent';
