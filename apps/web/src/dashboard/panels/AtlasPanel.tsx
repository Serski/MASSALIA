import { World2Map } from "../../map/World2Map.js";
import { DashboardCard } from "../shared.js";

// Atlas is the campaign map and nothing else: the fill card owns the whole pane
// (the pane lock in dashboard.css keys off .dashboard-map-card). Standings has
// its own sidebar entry; Cities and Diplomacy are tabs under Politics.
export default function AtlasPanel() {
  return (
    <section className="dashboard-panel atlas-dashboard-panel" aria-label="Atlas">
      <DashboardCard className="dashboard-map-card">
        <World2Map fill />
      </DashboardCard>
    </section>
  );
}
