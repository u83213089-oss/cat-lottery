export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-10">
      <div className="max-w-3xl w-full">
        <h1 className="text-4xl font-bold">嘉義縣品種貓認領養抽籤系統</h1>

        <p className="mt-4 text-lg opacity-80">
          管理端：/admin　｜　直播頁：/display
        </p>

        <div className="mt-8 space-x-4">
          <a className="underline" href="/admin">
            前往管理端
          </a>
          <a className="underline" href="/display">
            前往直播頁
          </a>
        </div>
      </div>
    </main>
  );
}
