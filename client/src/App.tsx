import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import { Landing } from "./pages/Landing";
import { ComingSoon } from "./pages/ComingSoon";

const Setup = lazy(() => import("./pages/Setup").then((m) => ({ default: m.Setup })));

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen" style={{ background: "var(--ground)" }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route
            path="/setup"
            element={
              <Suspense fallback={null}>
                <Setup />
              </Suspense>
            }
          />
          <Route
            path="/create"
            element={
              <ComingSoon
                title="Room creation is next"
                detail="The lobby, room codes, and QR sharing are being built in this milestone — check back shortly."
              />
            }
          />
          <Route
            path="/join"
            element={
              <ComingSoon
                title="Joining a room is next"
                detail="Enter-a-code and follow-a-link joining are being built in this milestone — check back shortly."
              />
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
