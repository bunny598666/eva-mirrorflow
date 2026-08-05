-- 004_prompt_version_freeze.sql —— 反思題目版本凍結（鐵則三的資料庫層強制）
--
-- 背景：STEP 1 驗收時發現，reflection_prompts 原本只靠「沒有 UPDATE 政策」擋住前端。
-- 那一層擋得住今天的學生，卻擋不住明天某個不小心加上的政策，也擋不住 service_role。
-- 而「三次作業的反思題目必須同版」是 CLAUDE.md §0 的三條鐵則之一：題目變了，
-- 「反思品質的變化」與「題目換了」就永遠分不開，該筆研究資料等於作廢。
--
-- 因此比照 002 的做法，在資料庫層擋死既有版本的修改與刪除。
-- 注意：INSERT 不受影響——新增版本仍然允許（BUILD_PLAN §7 允許 pilot 後、
-- 正式研究開始前發布新版本）。凍結的是「既有版本的內容」，不是「版本的數量」。

create or replace function forbid_prompt_version_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'reflection_prompts 版本凍結：既有版本不可修改或刪除，只能新增版本';
end
$$;

drop trigger if exists reflection_prompts_frozen on reflection_prompts;
create trigger reflection_prompts_frozen
  before update or delete on reflection_prompts
  for each row execute function forbid_prompt_version_mutation();
