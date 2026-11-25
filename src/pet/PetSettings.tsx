import { updatePetPreferences, useYuna } from "../lib/store";
import { PixelPet } from "./PixelPet";
import { petName, petNameLimit, petSizes } from "./preferences";
import "./pet.css";

export function PetSettings() {
  const { pet } = useYuna();
  return (
    <section className="pet-settings" aria-labelledby="pet-personalization">
      <h2 id="pet-personalization">Personalization</h2>
      <div className="pet-settings-card">
        <div className="pet-preview" aria-label={`Pixel-art preview of ${petName(pet)}`} role="img">
          <PixelPet mood="idle" size={petSizes[pet.size]} />
        </div>
        <div className="pet-options">
          <label className="pet-enable">Desktop Pet <input type="checkbox" checked={pet.enabled} onChange={(event) => updatePetPreferences({ enabled: event.target.checked })} /></label>
          <label>Pet name <input type="text" placeholder="Mochi" maxLength={petNameLimit} value={pet.name} onChange={(event) => updatePetPreferences({ name: event.target.value })} /></label>
          <label>Pet size <select value={pet.size} onChange={(event) => updatePetPreferences({ size: event.target.value as typeof pet.size })}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select></label>
        </div>
      </div>
      {!("__TAURI_INTERNALS__" in window) && <p>The floating pet is available in the desktop app. Preview and preferences are available here.</p>}
    </section>
  );
}
