function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSortedNumericKeys(obj) {
  return Object.keys(obj || {}).sort((a, b) => Number(a) - Number(b));
}

function getFrameMap(state) {
  if (!isObject(state?.frames)) {
    return {};
  }

  return state.frames;
}

function isGoogleSheetsState(state) {
  return Boolean(
    state?.surface === "google_sheets" ||
      state?.spreadsheetId ||
      state?.visibleGrid,
  );
}

function getFrameIds(state) {
  return toSortedNumericKeys(getFrameMap(state))
    .map((key) => Number(key))
    .filter((value) => Number.isInteger(value));
}

function getFrameCount(state) {
  return getFrameIds(state).length;
}

function getFrameState(state, frameId) {
  const frames = getFrameMap(state);
  return frames[String(frameId)] || null;
}

function getPrimaryFrameId(state) {
  const frameIds = getFrameIds(state);

  if (!frameIds.length) {
    return null;
  }

  if (frameIds.includes(0)) {
    return 0;
  }

  return frameIds[0];
}

function getPrimaryFrame(state) {
  const frameId = getPrimaryFrameId(state);

  if (!Number.isInteger(frameId)) {
    return null;
  }

  return getFrameState(state, frameId);
}

function getPrimaryUrl(state) {
  const frame = getPrimaryFrame(state);
  return frame?.url || "";
}

function getPrimaryTitle(state) {
  const frame = getPrimaryFrame(state);
  return frame?.title || "";
}

function getTotalControlsCount(state) {
  const frames = getFrameMap(state);

  let count = 0;

  for (const key of Object.keys(frames)) {
    const frame = frames[key];
    if (Array.isArray(frame?.controls)) {
      count += frame.controls.length;
    }
  }

  return count;
}

function getTotalScrollableContainersCount(state) {
  const frames = getFrameMap(state);

  let count = 0;

  for (const key of Object.keys(frames)) {
    const frame = frames[key];
    if (Array.isArray(frame?.scrollableContainers)) {
      count += frame.scrollableContainers.length;
    }
  }

  return count;
}

function getTotalHeadingsCount(state) {
  const frames = getFrameMap(state);

  let count = 0;

  for (const key of Object.keys(frames)) {
    const frame = frames[key];
    if (Array.isArray(frame?.headings)) {
      count += frame.headings.length;
    }
  }

  return count;
}

function getTotalVisibleTextCount(state) {
  const frames = getFrameMap(state);

  let count = 0;

  for (const key of Object.keys(frames)) {
    const frame = frames[key];
    if (Array.isArray(frame?.visibleTextSummary)) {
      count += frame.visibleTextSummary.length;
    }
  }

  return count;
}

function getTotalOverlaysCount(state) {
  const frames = getFrameMap(state);

  let count = 0;

  for (const key of Object.keys(frames)) {
    const frame = frames[key];
    if (Array.isArray(frame?.overlays)) {
      count += frame.overlays.length;
    }
  }

  return count;
}

export function getLastKnownUrlFromState(state) {
  if (!state || typeof state !== "object") {
    return "";
  }

  if (isGoogleSheetsState(state)) {
    return state.url || "";
  }

  const primaryUrl = getPrimaryUrl(state);
  if (primaryUrl) {
    return primaryUrl;
  }

  const frames = getFrameMap(state);
  const keys = toSortedNumericKeys(frames);

  for (const key of keys) {
    const url = frames[key]?.url;
    if (url) {
      return url;
    }
  }

  return "";
}

export function getAggregateStateSummary(state) {
  if (isGoogleSheetsState(state)) {
    return {
      frameCount: 0,
      primaryFrameId: null,
      url: state?.url || "",
      title: state?.spreadsheetTitle || state?.title || "",
      controlsCount: 0,
      scrollableContainersCount: 0,
      headingsCount: 0,
      visibleTextCount: Array.isArray(state?.visibleGrid?.values)
        ? state.visibleGrid.values.reduce(
            (count, row) => count + (Array.isArray(row) ? row.length : 0),
            0,
          )
        : 0,
      overlaysCount: 0,
      timestamp: state?.timestamp || "",
    };
  }

  const primaryFrameId = getPrimaryFrameId(state);
  const primaryFrame = getPrimaryFrame(state);

  return {
    frameCount: getFrameCount(state),
    primaryFrameId,
    url: primaryFrame?.url || "",
    title: primaryFrame?.title || "",
    controlsCount: getTotalControlsCount(state),
    scrollableContainersCount: getTotalScrollableContainersCount(state),
    headingsCount: getTotalHeadingsCount(state),
    visibleTextCount: getTotalVisibleTextCount(state),
    overlaysCount: getTotalOverlaysCount(state),
    timestamp: state?.timestamp || "",
  };
}
