/**
 * 離線佇列（STEP 5）：IndexedDB 存放待送事件，client_seq 自增，每 5 秒批次 POST，
 * 離線累積、上線補送。鐵則：事件寫入失敗不得丟資料——寧可重複送，由 DB 的
 * (session_id, client_seq) UNIQUE 去重。
 */

// 骨架檔：實作於上述 STEP。
export {};
