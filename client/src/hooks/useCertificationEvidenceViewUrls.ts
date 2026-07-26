import { trpc } from "@/lib/trpc";

/**
 * 依 factoryId（＋選填 revisionId，用於審核修改申請 diff 畫面）取得徽章證明
 * 圖片的短效 presigned 檢視網址 key→url 對照表。伺服器端只接受管理員身份
 * 呼叫（見 server/routers.ts 的 factory.getCertificationEvidenceViewUrls），
 * object key 一律由伺服器自己從資料庫目前實際存的 certificationEvidence／
 * revision 讀出，前端不傳、也不能傳任何 key 進去。網址有效期約 10 分鐘，
 * 過期後需要重新呼叫才能再次取得。
 *
 * 只給管理員審核頁面使用（FactoryReviewDetail.tsx／AdminDashboard.tsx）。
 * 工廠端（FactoryDashboard.tsx／BadgeEvidenceEditor.tsx）一律不得呼叫這支
 * hook——送出後不能再取得任何圖片網址，見各檔案內的相關註解。
 */
export function useCertificationEvidenceViewUrls(factoryId: number | undefined, revisionId?: number) {
  const { data, isLoading } = trpc.factory.getCertificationEvidenceViewUrls.useQuery(
    { factoryId: factoryId ?? 0, revisionId },
    {
      enabled: !!factoryId,
      // 網址 10 分鐘後過期，5 分鐘就視為過時並在背景重新換發，
      // 避免使用者停留較久時看到的縮圖用的是已經失效的網址。
      staleTime: 5 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
    }
  );
  return { urls: data?.urls ?? {}, isLoading };
}
