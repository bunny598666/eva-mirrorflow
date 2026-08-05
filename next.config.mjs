import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 明確指定工作區根目錄。使用者家目錄下有另一個 package-lock.json，
  // Next 會誤判根目錄在 C:\Users\jimmy，導致 build trace 收集錯檔案。
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
