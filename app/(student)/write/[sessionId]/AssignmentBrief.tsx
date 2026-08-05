"use client";

import { useState } from "react";

/** 作業說明。可收合，讓學生把畫面讓給文章；預設展開，第一次進來要看得到題目。 */
export default function AssignmentBrief({
  title,
  instructions,
  orderNo,
}: {
  title: string;
  instructions: string;
  orderNo: number;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="assignment-body"
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          <span className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white">
            第 {orderNo} 次
          </span>
          <span className="font-semibold">{title}</span>
          <span className="ml-auto text-sm text-neutral-500">
            {open ? "收起說明 ▲" : "看說明 ▼"}
          </span>
        </button>
      </h2>
      <div id="assignment-body" hidden={!open}>
        <p className="whitespace-pre-wrap border-t border-neutral-200 px-4 py-3 text-neutral-700">
          {instructions}
        </p>
      </div>
    </section>
  );
}
