export const petSizes = { small: 54, medium: 72, large: 96 } as const;
export const petNameLimit = 24;

export interface PetPreferences {
  enabled: boolean;
  name: string;
  size: keyof typeof petSizes;
}

const key = "yuna.desktop-pet.preferences";
const defaults: PetPreferences = { enabled: false, name: "Mochi", size: "medium" };

export function readPetPreferences(): PetPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<PetPreferences> | null;
    return {
      enabled: saved?.enabled === true,
      name: typeof saved?.name === "string" ? saved.name.slice(0, petNameLimit) : defaults.name,
      size: saved?.size === "small" || saved?.size === "large" ? saved.size : defaults.size,
    };
  } catch {
    return { ...defaults };
  }
}

export function savePetPreferences(value: PetPreferences) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences can still be used for this session when storage is unavailable.
  }
}

export function petName(value: PetPreferences) {
  return value.name.trim() || defaults.name;
}
