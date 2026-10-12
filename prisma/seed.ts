import { PrismaClient } from "@prisma/client";
import { seedReference } from "../src/server/seed/reference";

const db = new PrismaClient();
seedReference(db)
  .then(() => console.log("已建立球隊、球場、售票平台與付款方式預設資料"))
  .finally(() => db.$disconnect());
