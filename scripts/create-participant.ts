/**
 * 建立單一參與者（通常用來開出第一個 researcher 或 teacher 帳號——
 * 資料庫全空時沒有人能登入後台，得先有人破蛋）。
 *
 * PIN 由本腳本產生並「只印一次」，資料庫只存 bcrypt 雜湊（明碼不落庫）。
 *
 * 用法：
 *   npm run create:participant -- --code R-01 --role researcher
 *   npm run create:participant -- --code T-01 --role teacher --class <班級 uuid>
 */
import { randomInt } from "node:crypto";
import { Client } from "pg";
import bcrypt from "bcryptjs";

type Role = "student" | "teacher" | "researcher";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function generatePin(): string {
  let pin = "";
  for (let i = 0; i < 6; i += 1) pin += String(randomInt(0, 10));
  return pin;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  const code = arg("code")?.toUpperCase() ?? null;
  const role = (arg("role") ?? "researcher") as Role;
  const classId = arg("class");

  if (!code) {
    console.error("請指定 --code，例如：npm run create:participant -- --code R-01");
    process.exit(1);
  }
  if (!["student", "teacher", "researcher"].includes(role)) {
    console.error("--role 只能是 student / teacher / researcher");
    process.exit(1);
  }
  if (role !== "researcher" && !classId) {
    console.error("student 與 teacher 必須指定 --class <班級 uuid>");
    process.exit(1);
  }

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query<{ id: string }>(
      `insert into participants (code, pin_hash, class_id, role)
       values ($1, $2, $3, $4) returning id`,
      [code, pinHash, classId, role],
    );
    console.log("\n建立成功：");
    console.log("  id   :", res.rows[0]?.id);
    console.log("  代號 :", code);
    console.log("  角色 :", role);
    console.log("  PIN  :", pin);
    console.log("\n⚠ 這組 PIN 只會出現這一次，資料庫只存雜湊。現在就記下來。\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("participants_code_key")) {
      console.error(`代號 ${code} 已存在。`);
    } else {
      console.error("建立失敗：", message);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
