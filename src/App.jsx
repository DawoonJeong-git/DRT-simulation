// src/App.jsx
import MapView from "./maplibre/MapView";
import DeckCanvas from "./deck/DeckCanvas";
import CombinedView from "./combined/CombinedView";

function App() {
  const mode = "combined"; // "map", "deck", "combined"

  return (
    <>
      {mode === "map" && <MapView />}
      {mode === "deck" && <DeckCanvas />}
      {mode === "combined" && <CombinedView />}
    </>
  );
}

export default App;