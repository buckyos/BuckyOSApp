import { HashRouter as Router } from "react-router-dom";
import DidFlowRoutes from "../features/did/DidFlowRoutes";

export default function AppRoutes() {
  return (
    <Router>
      <div className="container">
        <DidFlowRoutes />
      </div>
    </Router>
  );
}
