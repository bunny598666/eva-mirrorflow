// 人工編碼介面：對話全文 + 反思全文，依 scheme_version 載入編碼架構（STEP 11）
//
// coder_code 取自登入身分（R-01 / R-02 各自登入），不由用戶端指定——
// 否則任何人都能以另一位編碼者的名義寫入，信度就沒有意義了。
import { requireRole } from "@/lib/auth/session";
import { listCodingUnits, loadCodingMaterial } from "@/lib/coding/queries";
import { CURRENT_SCHEME_VERSION, getScheme } from "@/lib/coding/scheme";
import CodingWorkbench from "./CodingWorkbench";

type Props = { searchParams: Promise<{ session?: string; scheme?: string }> };

export default async function CodingPage({ searchParams }: Props) {
  const claims = await requireRole("researcher");
  const params = await searchParams;

  const schemeVersion = params.scheme ?? CURRENT_SCHEME_VERSION;
  const scheme = getScheme(schemeVersion);

  const units = await listCodingUnits(claims.code, schemeVersion);
  const material = params.session
    ? await loadCodingMaterial(params.session, claims.code, schemeVersion)
    : null;

  return (
    <CodingWorkbench
      coderCode={claims.code}
      scheme={scheme}
      units={units}
      material={material}
    />
  );
}
