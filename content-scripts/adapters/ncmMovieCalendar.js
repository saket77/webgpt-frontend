(function () {
  const ADAPTER_ID = "ncm_movie_calendar.local";
  const MOVIE_RESULTS_TARGET_ID = `site:${ADAPTER_ID}:movie_results`;
  const registry = globalThis.WebGPTContentAdapters;
  const extractModules = globalThis.WebGPTExtractStateModules || {};
  const domUtils = extractModules.domUtils || {};

  if (!registry || typeof registry.register !== "function") {
    throw new Error(
      "content-scripts/adapters/registry.js must load before ncmMovieCalendar.js",
    );
  }

  const normalizeText =
    domUtils.normalizeText ||
    ((value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim());
  const lower =
    domUtils.lower || ((value) => normalizeText(value).toLowerCase());
  const textContent =
    domUtils.textContent ||
    ((el) => normalizeText(el?.innerText || el?.textContent || el?.value || ""));

  function unique(items) {
    return Array.from(new Set((items || []).filter(Boolean)));
  }

  function cssEscape(value) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === "function") {
      return globalThis.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function safeUrl(url) {
    try {
      return new URL(url || location.href);
    } catch {
      return new URL(location.href);
    }
  }

  function isNcmMovieCalendar(url, documentRef) {
    const parsed = safeUrl(url);
    if (parsed.hostname === "moviereleasecalendar.ncm.com") return true;

    return Boolean(
      documentRef.querySelector(
        [
          "ngx-movie-filter-results",
          "ngx-movie-view-detail",
          "[id^='detailContainer']",
          "[id^='movieTrailerPlayer'][data-movie-id]",
        ].join(","),
      ),
    );
  }

  function getElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(
      (el, index, arr) => el instanceof Element && arr.indexOf(el) === index,
    );
  }

  function firstElement(root, selectors) {
    for (const selector of selectors) {
      const el = root?.querySelector?.(selector);
      if (el instanceof Element) return el;
    }
    return null;
  }

  function firstText(root, selectors) {
    return normalizeText(textContent(firstElement(root, selectors)));
  }

  function elementBounds(el) {
    if (!el || !(el instanceof Element)) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function center(bounds) {
    return {
      x: Number(bounds?.x || 0) + Number(bounds?.width || 0) / 2,
      y: Number(bounds?.y || 0) + Number(bounds?.height || 0) / 2,
    };
  }

  function boundsContain(outer, inner) {
    if (!outer || !inner) return false;
    const point = center(inner);
    return (
      point.x >= outer.x &&
      point.x <= outer.x + outer.width &&
      point.y >= outer.y &&
      point.y <= outer.y + outer.height
    );
  }

  function selectorCandidatesFor(el) {
    if (!el || !(el instanceof Element)) return [];

    const tag = lower(el.tagName);
    const id = normalizeText(el.id);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));
    const result = [];

    if (id) result.push(`#${cssEscape(id)}`);

    for (const attr of ["data-testid", "data-test", "data-qa", "data-cy"]) {
      const value = normalizeText(el.getAttribute(attr));
      if (value) result.push(`[${attr}="${cssEscape(value)}"]`);
    }

    if (name) result.push(`${tag}[name="${cssEscape(name)}"]`);
    if (ariaLabel) result.push(`${tag}[aria-label="${cssEscape(ariaLabel)}"]`);
    if (title) result.push(`${tag}[title="${cssEscape(title)}"]`);

    return result;
  }

  function findControlBySelector(controls, selectors, bounds, tag) {
    const matches = (controls || []).filter((control) =>
      selectors.has(control.selector),
    );
    if (matches.length === 1) return matches[0];

    return (
      matches.find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      matches.find((control) => boundsContain(control.bounds, bounds)) ||
      null
    );
  }

  function findControlForElement(controls, el) {
    if (!el || !(el instanceof Element)) return null;

    const selectors = new Set(selectorCandidatesFor(el));
    const tag = lower(el.tagName);
    const name = normalizeText(el.getAttribute("name"));
    const ariaLabel = normalizeText(el.getAttribute("aria-label"));
    const title = normalizeText(el.getAttribute("title"));
    const bounds = elementBounds(el);

    return (
      findControlBySelector(controls, selectors, bounds, tag) ||
      (controls || []).find(
        (control) =>
          name &&
          control.name === name &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          ariaLabel &&
          control.ariaLabel === ariaLabel &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          title && control.title === title && (!control.tag || !tag || control.tag === tag),
      ) ||
      (controls || []).find(
        (control) =>
          boundsContain(bounds, control.bounds) &&
          (!control.tag || !tag || control.tag === tag),
      ) ||
      null
    );
  }

  function findBestControlInRegion(controls, regionEl, options = {}) {
    const regionBounds = elementBounds(regionEl);
    if (!regionBounds) return null;

    let best = null;
    for (const control of controls || []) {
      if (!boundsContain(regionBounds, control.bounds)) continue;

      const haystack = lower(
        [
          control.label,
          control.text,
          control.title,
          control.ariaLabel,
          control.className,
          control.selector,
        ].join(" "),
      );
      let score =
        Number(control.bounds?.width || 0) * Number(control.bounds?.height || 0);

      if (options.text && haystack.includes(lower(options.text))) score += 50000;
      if (options.preferInput && control.tag === "input") score += 100000;
      if (options.preferButton && control.tag === "button") score += 100000;
      if (control.enabled) score += 1000;
      if (control.visible) score += 1000;

      if (!best || score > best.score) {
        best = { control, score };
      }
    }

    return best?.control || null;
  }

  function findFieldControl(state, selector, text = "") {
    const el = document.querySelector(selector);
    if (!el) return null;
    return (
      findControlForElement(state.controls, el) ||
      findBestControlInRegion(state.controls, el.closest("mat-form-field") || el, {
        preferInput: true,
        text,
      })
    );
  }

  function normalizedRatingFromSrc(src) {
    const raw = normalizeText(src);
    if (!raw) return "";

    const fileName = raw.split("?")[0].split("#")[0].split("/").pop() || "";
    const value = fileName
      .replace(/-icon\.svg$/i, "")
      .replace(/_/g, "-")
      .toUpperCase();

    if (["G", "PG", "PG-13", "R", "NC-17", "NR"].includes(value)) {
      return value;
    }

    return "";
  }

  function ratingForCard(card) {
    const img = firstElement(card, [
      "img[id^='mpaaRatingImg']",
      "img[src*='-icon.svg']",
    ]);
    const fromSrc = normalizedRatingFromSrc(img?.getAttribute("src"));
    if (fromSrc) return fromSrc;

    const alt = normalizeText(img?.getAttribute("alt"));
    return /^(G|PG|PG-13|R|NC-17|NR)$/i.test(alt) ? alt.toUpperCase() : "";
  }

  function movieIdForCard(card) {
    const detailId = normalizeText(
      firstElement(card, ["[id^='detailContainer']"])?.id || card.id,
    );
    const detailMatch = detailId.match(/detailContainer(\d+)/i);
    if (detailMatch) return detailMatch[1];

    const poster = firstElement(card, ["[data-movie-id]", "[id^='movieTrailerPlayer']"]);
    const dataId = normalizeText(poster?.getAttribute("data-movie-id"));
    if (dataId) return dataId;

    const posterId = normalizeText(poster?.id);
    const posterMatch = posterId.match(/movieTrailerPlayer(\d+)/i);
    return posterMatch ? posterMatch[1] : "";
  }

  function findWeekText(card) {
    let el = card;
    while (el && el !== document.body) {
      let sibling = el.previousElementSibling;
      while (sibling) {
        const text = textContent(sibling);
        if (lower(text).includes("week of:")) return text;
        const weekly = sibling.querySelector?.(".weekly-bar");
        if (weekly) return textContent(weekly);
        sibling = sibling.previousElementSibling;
      }
      el = el.parentElement;
    }
    return "";
  }

  function extractDateFromWeekText(text) {
    const match = normalizeText(text).match(/week of:\s*(.+)$/i);
    return match ? normalizeText(match[1]) : normalizeText(text);
  }

  function movieText(movie) {
    return [
      movie.weekOf ? `Week Of: ${movie.weekOf}` : "",
      movie.releaseDate ? `Release Date: ${movie.releaseDate}` : "",
      movie.title ? `Title: ${movie.title}` : "",
      movie.distributor ? `Distributor: ${movie.distributor}` : "",
      movie.rating ? `Rating: ${movie.rating}` : "",
      movie.genre ? `Genre: ${movie.genre}` : "",
      movie.leadActors ? `Lead Actors: ${movie.leadActors}` : "",
      movie.directedBy ? `Directed By: ${movie.directedBy}` : "",
      movie.synopsis ? `Synopsis: ${movie.synopsis}` : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  function collectMovieRecords(documentRef, state, resultContainerTargetId) {
    const cardRoots = getElements("ngx-movie-view-detail", documentRef);
    const fallbackRoots = getElements("[id^='detailContainer']", documentRef);
    const roots = cardRoots.length ? cardRoots : fallbackRoots;
    const seen = new Set();
    const records = [];

    for (const root of roots) {
      const card = root.matches("[id^='detailContainer']")
        ? root
        : firstElement(root, ["[id^='detailContainer']"]) || root;

      const movieId = movieIdForCard(card);
      const title =
        firstText(card, ["#movieDetailTitle", "[id='movieDetailTitle']"]) ||
        normalizeText(
          firstElement(card, ["[data-movie-id]", "[id^='movieTrailerPlayer']"])
            ?.getAttribute("title"),
        );
      const releaseDate = firstText(card, ["#releaseDate", "[id='releaseDate']"]);
      const genre = firstText(card, ["#nielsenGenre", "[id='nielsenGenre']"]);
      const distributor = firstText(card, [
        "[id^='movieStudio']",
        "[id*='Studio']",
      ]);
      const synopsis = firstText(card, ["[id^='synopsis']"]);
      const leadActors = firstText(card, ["[id^='movieCast']"]);
      const directedBy = firstText(card, ["[id^='movieDirector']"]);
      const rating = ratingForCard(card);
      const posterUrl = normalizeText(
        firstElement(card, ["img[id^='moviePoster']"])?.getAttribute("src"),
      );
      const weekOf = extractDateFromWeekText(findWeekText(card));

      if (!title && !movieId) continue;

      const key = movieId || `${title}|${releaseDate}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const control =
        findControlForElement(state.controls, card) ||
        findBestControlInRegion(state.controls, card, { text: title });
      const movie = {
        movieId,
        title,
        releaseDate,
        weekOf,
        distributor,
        rating,
        genre,
        leadActors,
        directedBy,
        synopsis,
        posterUrl,
        cardTargetId: control?.id || "",
        resultContainerTargetId,
        bounds: elementBounds(card) || elementBounds(root),
      };

      records.push(movie);
    }

    return records;
  }

  function collectionGroup(records, resultContainerTargetId, view) {
    if (!records.length) return null;

    const completeCount = records.filter(
      (movie) =>
        movie.title &&
        movie.releaseDate &&
        movie.distributor &&
        movie.rating &&
        movie.genre &&
        movie.leadActors,
    ).length;

    return {
      id: "ncm_movie_results",
      targetId: MOVIE_RESULTS_TARGET_ID,
      kind: "ncm_movie_results",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      label: "NCM movie results",
      text: [
        `${records.length} movie records loaded in DOM`,
        `${completeCount} records have release date, title, distributor, rating, genre, and lead actors`,
        `current view: ${view}`,
        resultContainerTargetId
          ? `results container control: ${resultContainerTargetId}`
          : "",
      ]
        .filter(Boolean)
        .join("; "),
      controlIds: unique([resultContainerTargetId]),
    };
  }

  function movieGroups(records) {
    return records.map((movie, index) => ({
      id: `ncm_movie_${movie.movieId || index + 1}`,
      targetId: `site:${ADAPTER_ID}:movie:${movie.movieId || index + 1}`,
      collectionTargetId: MOVIE_RESULTS_TARGET_ID,
      resultContainerTargetId: movie.resultContainerTargetId,
      kind: "ncm_movie_result",
      adapterId: ADAPTER_ID,
      preferredAction: "extract",
      label: `NCM movie: ${movie.title || movie.movieId || index + 1}`,
      text: movieText(movie),
      position: index + 1,
      movieId: movie.movieId,
      title: movie.title,
      releaseDate: movie.releaseDate,
      weekOf: movie.weekOf,
      distributor: movie.distributor,
      rating: movie.rating,
      genre: movie.genre,
      leadActors: movie.leadActors,
      directedBy: movie.directedBy,
      synopsis: movie.synopsis,
      posterUrl: movie.posterUrl,
      controlIds: unique([movie.cardTargetId, movie.resultContainerTargetId]),
      cardTargetId: movie.cardTargetId,
      bounds: movie.bounds,
    }));
  }

  function filterGroup(state) {
    const startControl = findFieldControl(state, "#datePickerStartDate", "start date");
    const endControl = findFieldControl(state, "#datePickerEndDate", "end date");
    const ratingControls = ["G", "PG", "PG-13", "R"].map((rating) => {
      const button =
        document.querySelector(`#ratingToggle_${rating.replace("-", "_")}-button`) ||
        document.querySelector(`#ratingToggle_${rating.replace("-", "_")}`);
      const control =
        findControlForElement(state.controls, button) ||
        findBestControlInRegion(state.controls, button, {
          preferButton: true,
          text: rating,
        });
      return {
        rating,
        targetId: control?.id || "",
        selected:
          normalizeText(button?.getAttribute("aria-pressed")).toLowerCase() ===
          "true",
      };
    });
    const genreHeader = document.querySelector("mat-expansion-panel-header");
    const genreControl =
      findControlForElement(state.controls, genreHeader) ||
      findBestControlInRegion(state.controls, genreHeader, { text: "genre" });
    const calendarToggleIds = unique(
      (state.controls || [])
        .filter((control) =>
          lower(`${control?.label || ""} ${control?.text || ""}`).includes(
            "open calendar",
          ),
        )
        .map((control) => control.id),
    );

    return {
      id: "ncm_filters",
      kind: "ncm_filters",
      adapterId: ADAPTER_ID,
      label: "NCM movie filters",
      text: [
        startControl ? `Start Date: ${startControl.text || startControl.value || ""}` : "",
        endControl ? `End Date: ${endControl.text || endControl.value || ""}` : "",
        `Ratings: ${ratingControls.map((item) => item.rating).join(", ")}`,
        genreControl ? "Genre filter available" : "",
      ]
        .filter(Boolean)
        .join("; "),
      startDateTargetId: startControl?.id || "",
      endDateTargetId: endControl?.id || "",
      genreTargetId: genreControl?.id || "",
      calendarToggleIds,
      ratings: ratingControls,
      controlIds: unique([
        startControl?.id,
        endControl?.id,
        genreControl?.id,
        ...calendarToggleIds,
        ...ratingControls.map((item) => item.targetId),
      ]),
    };
  }

  function currentView(documentRef, records) {
    const toggleTitle = normalizeText(
      textContent(documentRef.querySelector(".switch title")) ||
        documentRef.querySelector(".switch")?.getAttribute("title"),
    );

    if (lower(toggleTitle).includes("change to poster view")) return "list";
    if (lower(toggleTitle).includes("change to list view")) return "poster";

    const hasDetailFields = records.some(
      (movie) => movie.distributor || movie.leadActors || movie.synopsis,
    );
    return hasDetailFields ? "list" : "poster";
  }

  function findViewToggleControl(state) {
    const input = document.querySelector(".switch input[type='checkbox']");
    const label = document.querySelector(".switch");
    return (
      findControlForElement(state.controls, input) ||
      findControlForElement(state.controls, label) ||
      findBestControlInRegion(state.controls, label || input, { text: "view" })
    );
  }

  function findResultsContainerControl(state, documentRef) {
    const resultsEl =
      documentRef.querySelector(".result-scroll.movie-filter-result-container") ||
      documentRef.querySelector("ngx-movie-filter-results") ||
      documentRef.querySelector(".movie-filter-result-container");

    return (
      findControlForElement(state.controls, resultsEl) ||
      findBestControlInRegion(state.controls, resultsEl, { text: "week of" })
    );
  }

  function addHint(actionHintsByTargetId, targetId, hint) {
    if (!targetId) return;
    actionHintsByTargetId[targetId] = {
      ...(actionHintsByTargetId[targetId] || {}),
      ...hint,
    };
  }

  function buildActionHints(state, filters, viewToggle, resultsControl, view) {
    const actionHintsByTargetId = {};

    addHint(actionHintsByTargetId, resultsControl?.id, {
      semanticRole: "ncm_movie_results_collection",
      preferredAction: "extract",
      exactValueMode: "stateRecords",
      verifyAfterAction: "movieRecordsExtracted",
      instruction:
        "Extract this NCM results container to save one state-derived movie record per loaded card.",
    });

    addHint(actionHintsByTargetId, viewToggle?.id, {
      semanticRole: "ncm_view_toggle",
      preferredAction: "click",
      verifyAfterAction: "viewChanged",
      instruction:
        view === "poster"
          ? "Switch to list view before extracting full movie details such as distributor and lead actors."
          : "Current list view already exposes full movie details; do not click this unless the task explicitly asks for poster view.",
    });

    addHint(actionHintsByTargetId, filters.startDateTargetId, {
      semanticRole: "ncm_start_date_filter",
      preferredAction: "fill",
      editorKind: "date",
      exactValueMode: "dateText",
      navigationAction: true,
      batchPlacement: "last",
      verifyAfterAction: "filterApplied",
      instruction:
        "Changing this date can reload the results. Fill it as the final page-changing action, then wait for movie records to reload before extracting or handing off.",
    });

    addHint(actionHintsByTargetId, filters.endDateTargetId, {
      semanticRole: "ncm_end_date_filter",
      preferredAction: "fill",
      editorKind: "date",
      exactValueMode: "dateText",
      navigationAction: true,
      batchPlacement: "last",
      verifyAfterAction: "filterApplied",
      instruction:
        "Changing this date can reload the results. Fill it as the final page-changing action, then wait for movie records to reload before extracting or handing off.",
    });

    for (const targetId of filters.calendarToggleIds || []) {
      addHint(actionHintsByTargetId, targetId, {
        semanticRole: "ncm_datepicker_toggle",
        preferredAction: "click",
        verifyAfterAction: "datepickerOpened",
        instruction:
          "This only opens the date picker popup; it does not apply date filters or regenerate movie results.",
      });
    }

    addHint(actionHintsByTargetId, filters.genreTargetId, {
      semanticRole: "ncm_genre_filter_panel",
      preferredAction: "click",
      verifyAfterAction: "genreFilterExpanded",
    });

    for (const rating of filters.ratings || []) {
      addHint(actionHintsByTargetId, rating.targetId, {
        semanticRole: "ncm_rating_filter",
        preferredAction: "click",
        answerText: rating.rating,
        verifyAfterAction: "ratingFilterToggled",
      });
    }

    return actionHintsByTargetId;
  }

  function buildPlannerHints(records, view, filters, resultsControl, viewToggle) {
    return [
      `NCM Movie Release Calendar adapter active; current view: ${view}.`,
      records.length
        ? `Detected ${records.length} loaded movie records in the DOM. To extract the movie list in the fewest steps, use extract.targetId="${MOVIE_RESULTS_TARGET_ID}".`
        : "No detailed movie records detected yet; do not extract or hand off to another surface until movie records are visible. If dates were just changed, wait for the results to reload.",
      resultsControl?.id
        ? `The visible results container control ${resultsControl.id} also extracts all NCM movie records.`
        : "",
      view === "poster" && viewToggle?.id
        ? `Poster view is compact; click ${viewToggle.id} to switch to list view before extracting distributor/cast fields.`
        : "List view already contains rating, genre, release date, distributor, and lead actors; avoid toggling view before extraction.",
      filters.startDateTargetId && filters.endDateTargetId
        ? `Use Start Date target ${filters.startDateTargetId} and End Date target ${filters.endDateTargetId} only when the requested date range is not already applied; date changes can reload the page state, so extract in a later step after records are detected.`
        : "",
    ].filter(Boolean);
  }

  function enhanceControls(controls, actionHintsByTargetId) {
    return (controls || []).map((control) => {
      const hint = actionHintsByTargetId?.[control.id];
      if (!hint) return control;

      return {
        ...control,
        adapterHints: {
          ...(control.adapterHints || {}),
          [ADAPTER_ID]: hint,
        },
      };
    });
  }

  function buildSiteAdapter(state, documentRef) {
    const resultsControl = findResultsContainerControl(state, documentRef);
    const records = collectMovieRecords(
      documentRef,
      state,
      resultsControl?.id || "",
    );
    const view = currentView(documentRef, records);
    const viewToggle = findViewToggleControl(state);
    const filters = filterGroup(state);
    const actionHintsByTargetId = buildActionHints(
      state,
      filters,
      viewToggle,
      resultsControl,
      view,
    );
    const groups = [
      collectionGroup(records, resultsControl?.id || "", view),
      filters,
      ...movieGroups(records),
    ].filter(Boolean);

    return {
      id: ADAPTER_ID,
      pageKind: "movie_release_calendar_results",
      currentView: view,
      movieResultsTargetId: MOVIE_RESULTS_TARGET_ID,
      resultContainerTargetId: resultsControl?.id || "",
      viewToggleTargetId: viewToggle?.id || "",
      detectedMovieCount: records.length,
      completeMovieCount: records.filter(
        (movie) =>
          movie.title &&
          movie.releaseDate &&
          movie.distributor &&
          movie.rating &&
          movie.genre &&
          movie.leadActors,
      ).length,
      primaryControlIds: unique([
        resultsControl?.id,
        viewToggle?.id,
        filters.startDateTargetId,
        filters.endDateTargetId,
        filters.genreTargetId,
        ...(filters.ratings || []).map((rating) => rating.targetId),
      ]),
      actionHintsByTargetId,
      plannerHints: buildPlannerHints(
        records,
        view,
        filters,
        resultsControl,
        viewToggle,
      ),
      groups,
    };
  }

  registry.register({
    id: ADAPTER_ID,
    priority: 80,

    match({ url, document: documentRef }) {
      return isNcmMovieCalendar(url, documentRef);
    },

    enhanceState({ state, document: documentRef }) {
      const siteAdapter = buildSiteAdapter(state, documentRef);
      const pageFactSummary = [
        `NCM page kind: ${siteAdapter.pageKind}`,
        `current view: ${siteAdapter.currentView}`,
        `${siteAdapter.detectedMovieCount} movie records detected`,
        `${siteAdapter.completeMovieCount} complete movie records detected`,
        `movie results extract target: ${siteAdapter.movieResultsTargetId}`,
      ].join("; ");

      return {
        ...state,
        site: {
          ...(state.site || {}),
          id: "ncm_movie_calendar",
          mode: siteAdapter.pageKind,
        },
        pageFacts: {
          ...(state.pageFacts || {}),
          ncmPageKind: siteAdapter.pageKind,
          ncmCurrentView: siteAdapter.currentView,
          ncmDetectedMovieCount: siteAdapter.detectedMovieCount,
          ncmCompleteMovieCount: siteAdapter.completeMovieCount,
          ncmMovieResultsTargetId: siteAdapter.movieResultsTargetId,
        },
        siteAdapter: {
          id: siteAdapter.id,
          pageKind: siteAdapter.pageKind,
          currentView: siteAdapter.currentView,
          movieResultsTargetId: siteAdapter.movieResultsTargetId,
          resultContainerTargetId: siteAdapter.resultContainerTargetId,
          viewToggleTargetId: siteAdapter.viewToggleTargetId,
          detectedMovieCount: siteAdapter.detectedMovieCount,
          completeMovieCount: siteAdapter.completeMovieCount,
          primaryControlIds: siteAdapter.primaryControlIds,
          actionHintsByTargetId: siteAdapter.actionHintsByTargetId,
          plannerHints: siteAdapter.plannerHints,
        },
        visibleTextSummary: unique([
          pageFactSummary,
          ...siteAdapter.plannerHints,
          ...(state.visibleTextSummary || []),
        ]).slice(0, 80),
        groups: [...siteAdapter.groups, ...(state.groups || [])],
        controls: enhanceControls(
          state.controls || [],
          siteAdapter.actionHintsByTargetId || {},
        ),
      };
    },
  });
})();
