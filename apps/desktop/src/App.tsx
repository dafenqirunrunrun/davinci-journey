import { PublishFlow } from "./components/PublishFlow";

export function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">本地管理工具</p>
          <h1>达芬奇的奇妙之旅</h1>
        </div>
      </header>

      <PublishFlow />
    </main>
  );
}
