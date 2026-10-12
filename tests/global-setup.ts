import { execSync } from "child_process";

export default function setup() {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("測試必須使用測試資料庫（DATABASE_URL 需包含 _test）");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
