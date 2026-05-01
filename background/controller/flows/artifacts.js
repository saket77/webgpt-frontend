export function createListArtifacts({ plannerAdapter }) {
  return async function listArtifacts() {
    const result = await plannerAdapter.fetchArtifacts();

    if (!Array.isArray(result)) {
      throw new Error("Invalid artifacts response.");
    }

    return result;
  };
}
