import type { Applicant, Cat } from "./lotteryEngine";

// 先做 10 隻貓示範，你之後改成 31 隻（28+3）
export const cats: Cat[] = [
  { id: "cat-01", label: "貓 01｜小花", popular: true },
  { id: "cat-02", label: "貓 02｜奶茶", popular: true },
  { id: "cat-03", label: "貓 03｜阿虎", popular: true },
  { id: "cat-04", label: "貓 04｜麻糬" },
  { id: "cat-05", label: "貓 05｜布丁" },
  { id: "cat-06", label: "貓 06｜可可" },
  { id: "cat-07", label: "貓 07｜小黑" },
  { id: "cat-08", label: "貓 08｜雪球" },
  { id: "cat-09", label: "貓 09｜QQ" },
  { id: "cat-10", label: "貓 10｜饅頭" },
];

// 假報名者（之後換成真名單匯入）
const applicants: Applicant[] = Array.from({ length: 40 }).map((_, i) => {
  const no = String(i + 1).padStart(2, "0");
  return {
    uid: `09${no}****-1${no}${no}`, // 只是示意
    name: `民眾${no}`,
  };
});

// 假「報名關係」：每隻貓隨機 12~22 人報名（方便測重複中籤跳過）
export const applicationsByCatId: Record<string, Applicant[]> = Object.fromEntries(
  cats.map((c) => {
    const count = 12 + Math.floor(Math.random() * 11);
    const shuffled = [...applicants].sort(() => Math.random() - 0.5);
    return [c.id, shuffled.slice(0, count)];
  })
);
