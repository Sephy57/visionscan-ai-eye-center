import { SPECIALTY_REGISTRY } from "@/lib/clinical/specialistRegistry";
import { getCapabilitiesForSpecialty } from "@/lib/clinical/specialistCapabilities";
import { Icon } from "./icons";

/**
 * Specialist review lanes, derived entirely from the documentation-only
 * specialty registry and the computed capability table. A lane shows a
 * research probe ONLY when a capability's `may_execute` is true; every other
 * lane is explicitly "no compatible image model". Lanes route evidence for
 * human review — they are not AI doctors and never produce a diagnosis.
 */
const LANES = SPECIALTY_REGISTRY.map((specialty) => {
  const capabilities = getCapabilitiesForSpecialty(specialty.specialty_id);
  const executable = capabilities.filter((c) => c.may_execute);
  return {
    id: specialty.specialty_id,
    label: specialty.label,
    modalities: specialty.relevant_modalities,
    executable,
    documented: capabilities.length,
    populationValidation: specialty.requires_population_specific_validation,
  };
});

export const SPECIALIST_LANE_COUNT = LANES.length;
export const SPECIALIST_EXECUTABLE_LANE_COUNT = LANES.filter((l) => l.executable.length > 0).length;

export default function SpecialistBoard() {
  return (
    <div className="specialist-board">
      {LANES.map((lane) => {
        const active = lane.executable.length > 0;
        return (
          <article className={`specialist-lane${active ? " active" : ""}`} key={lane.id}>
            <div className="specialist-lane-top">
              <span className={`specialist-lane-status${active ? "" : " neutral"}`}>
                <Icon name={active ? "flask" : "circle"} size={11} />
                {active ? "RESEARCH PROBE" : "NO COMPATIBLE IMAGE MODEL"}
              </span>
            </div>
            <h3>{lane.label}</h3>
            <dl className="lane-facts">
              <dt>Modalities</dt><dd>{lane.modalities.join(" · ")}</dd>
              <dt>Model</dt><dd>{active ? lane.executable.map((c) => c.label).join("; ") : "None available"}</dd>
              <dt>Assessment</dt><dd>{active ? "Research observation only" : "Evidence organisation only"}</dd>
            </dl>
            <p className="tiny specialist-lane-note">
              {lane.populationValidation
                ? "Population-specific validation required before any model use. Clinician review required."
                : "Clinician review required for every evidence package."}
            </p>
          </article>
        );
      })}
    </div>
  );
}
