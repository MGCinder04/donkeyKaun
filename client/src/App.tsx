import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import { Landing } from "./pages/Landing";
import { TopBar } from "./components/TopBar";

const Setup = lazy(() => import("./pages/Setup").then((m) => ({ default: m.Setup })));
const Create = lazy(() => import("./pages/Create").then((m) => ({ default: m.Create })));
const Join = lazy(() => import("./pages/Join").then((m) => ({ default: m.Join })));
const Room = lazy(() => import("./pages/Room").then((m) => ({ default: m.Room })));

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen" style={{ background: "var(--ground)" }}>
        <TopBar />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/create" element={<Create />} />
            <Route path="/join" element={<Join />} />
            <Route path="/room/:code" element={<Room />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
