import GameBoard from "@/components/GameBoard";

// 开局设置经 localStorage 传递（主页「开始游戏」写入），URL 保持 /play 不带参数
export default function PlayPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <GameBoard />
    </main>
  );
}
