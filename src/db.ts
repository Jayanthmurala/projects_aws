import { PrismaClient } from "@prisma/client";
import { env } from "./config/env";

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${env.DATABASE_URL}&connection_limit=20&pool_timeout=20&socket_timeout=60`
    }
  },
  log: env.NODE_ENV === 'development' ? ['query', 'error'] : ['error']
});
