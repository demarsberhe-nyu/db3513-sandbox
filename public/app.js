const SLOT_HEADINGS = ['You', 'Second person'];
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
const CHOICES_STORAGE_KEY = 'shortlist-choices';
const UNDO_WINDOW_MS = 6000;
const LOADING_MESSAGE_MS = 3000;
const LOADING_MESSAGES = [
  'Checking what is on your services…',
  "Leaving out what you've already seen…",
  'Asking Claude for the best fits…',
  'Writing why each one suits you…',
];
const MOOD_NOTES = {
  light: 'Comfort, comedy, nothing heavy',
  intense: 'Big drama, edge of your seat',
  either: 'Let your taste decide',
};

const container = document.getElementById('container');
const people = document.getElementById('people');
const toTonight = document.getElementById('to-tonight');
const finderForm = document.getElementById('finder-form');
const finderButton = document.getElementById('finder-button');
const finderHint = document.getElementById('finder-hint');
const servicesLegend = document.getElementById('services-legend');
const serviceOptions = document.getElementById('service-options');
const moodOptions = document.getElementById('mood-options');
const region = document.getElementById('region');
const loading = document.getElementById('loading');
const loadingStatus = document.getElementById('loading-status');
const failure = document.getElementById('failure');
const failureMessage = document.getElementById('failure-message');
const results = document.getElementById('results');
const resultsHeading = document.getElementById('results-heading');
const resultsSummary = document.getElementById('results-summary');
const resultsList = document.getElementById('results-list');
const restorePicks = document.getElementById('restore-picks');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastAction = document.getElementById('toast-action');

let profiles = [null, null];
let addingSecondPerson = false;
let pendingRemoval = null;
let lastChoices = null;
let hasShortlist = false;
let toastTimer = null;
let loadingTimer = null;

function cloneTemplate(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function field(root, name) {
  return root.querySelector(`[data-field="${name}"]`);
}

function showError(section, message) {
  const error = field(section, 'error');
  error.textContent = message;
  error.hidden = false;
}

async function api(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error("Couldn't reach the app. Check your connection and try again.");
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error('The app sent back something unexpected. Try again in a minute.');
  }
  if (!response.ok) throw new Error(body.error);
  return body;
}

function filledCount() {
  return profiles.filter(Boolean).length;
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}

function showToast(text, action) {
  clearTimeout(toastTimer);
  toastText.textContent = text;
  toastAction.hidden = !action;
  toastAction.textContent = action?.label ?? '';
  toastAction.onclick = action?.run ?? null;
  toast.hidden = false;
  toastTimer = setTimeout(hideToast, UNDO_WINDOW_MS);
}

// Steps
function canVisit(step) {
  if (step === 'tonight') return filledCount() > 0;
  if (step === 'shortlist') return hasShortlist;
  return true;
}

function updateSteps(active) {
  for (const link of document.querySelectorAll('[data-step-link]')) {
    const step = link.dataset.stepLink;
    link.disabled = !canVisit(step);
    if (step === active) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  }
}

function currentStep() {
  return container.dataset.active;
}

function focusHeading(root) {
  root.querySelector('.step-heading').focus({ preventScroll: true });
}

function showStep(step) {
  container.dataset.active = step;
  for (const section of document.querySelectorAll('[data-step]')) {
    section.hidden = section.dataset.step !== step;
  }
  updateSteps(step);
  window.scrollTo(0, 0);
}

function goToStep(step) {
  showStep(step);
  if (step === 'shortlist') {
    focusHeading([loading, failure, results].find((panel) => !panel.hidden));
  } else {
    focusHeading(document.querySelector(`[data-step="${step}"]`));
  }
}

// People
async function finishRemoval() {
  if (!pendingRemoval) return;
  const { slot, timer } = pendingRemoval;
  clearTimeout(timer);
  pendingRemoval = null;
  hideToast();
  try {
    await api(`/api/profiles/${slot}`, { method: 'DELETE' });
  } catch (error) {
    showToast("Couldn't remove that person. Refresh the page and try again.");
  }
}

function undoRemoval() {
  const { slot, profile, timer } = pendingRemoval;
  clearTimeout(timer);
  pendingRemoval = null;
  profiles[slot] = profile;
  hideToast();
  renderPeople();
}

// The profile only leaves the server once the Undo window has passed.
async function startRemoval(slot) {
  await finishRemoval();
  const profile = profiles[slot];
  profiles[slot] = null;
  pendingRemoval = { slot, profile, timer: setTimeout(finishRemoval, UNDO_WINDOW_MS) };
  renderPeople();
  showToast(`Removed ${profile.name}.`, { label: 'Undo', run: undoRemoval });
}

function setChosenFiles(section, files) {
  const count = files.length;
  field(section, 'file-names').textContent = count === 0
    ? 'or click to choose the ZIP file'
    : [...files].map((file) => file.name).join(', ');
  field(section, 'dropzone').classList.toggle('has-files', count > 0);
}

function setUpDropzone(section) {
  const dropzone = field(section, 'dropzone');
  const input = field(section, 'files');

  input.addEventListener('change', () => setChosenFiles(section, input.files));

  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragging'));
  }
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    input.files = event.dataTransfer.files;
    setChosenFiles(section, input.files);
  });
}

function renderUpload(slot) {
  const section = cloneTemplate('upload-template');
  field(section, 'heading').textContent = SLOT_HEADINGS[slot];
  setUpDropzone(section);

  const form = section.querySelector('form');
  const button = form.querySelector('button');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    field(section, 'error').hidden = true;
    button.disabled = true;
    button.textContent = 'Reading your export…';

    try {
      await finishRemoval();
      const body = await api(`/api/profiles/${slot}`, { method: 'POST', body: new FormData(form) });
      profiles = body.profiles;
      if (slot === 1) addingSecondPerson = false;
      renderPeople();
    } catch (error) {
      showError(section, error.message);
      button.disabled = false;
      button.textContent = 'Add';
    }
  });

  return section;
}

function renderInvite() {
  const section = cloneTemplate('invite-template');
  field(section, 'add').addEventListener('click', () => {
    addingSecondPerson = true;
    renderPeople();
  });
  return section;
}

function renderFilm(film) {
  const item = document.createElement('li');
  const title = document.createElement('span');
  const rating = document.createElement('span');
  title.textContent = film.year ? `${film.name} (${film.year})` : film.name;
  rating.textContent = `${film.rating}★`;
  rating.className = 'rating';
  item.append(title, rating);
  return item;
}

function setUpNetflix(section, slot, profile) {
  const count = profile.netflixTitleCount;
  const buttonText = count > 0 ? 'Replace Netflix history' : 'Add Netflix history';
  const label = field(section, 'netflix-label');
  const fileInput = field(section, 'netflix-file');

  label.textContent = buttonText;
  field(section, 'netflix-status').textContent = count > 0
    ? `${count} titles read. Anything you've watched won't be recommended.`
    : "Upload NetflixViewingHistory.csv so movies you've watched there aren't recommended.";

  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length === 0) return;
    field(section, 'error').hidden = true;
    label.textContent = 'Reading…';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const body = await api(`/api/profiles/${slot}/netflix`, { method: 'POST', body: formData });
      profiles = body.profiles;
      renderPeople();
    } catch (error) {
      showError(section, error.message);
      label.textContent = buttonText;
      fileInput.value = '';
    }
  });
}

function renderProfile(slot, profile) {
  const section = cloneTemplate('profile-template');
  field(section, 'heading').textContent = profile.name;
  field(section, 'summary').textContent =
    `${profile.watchlistCount} on watchlist · ${profile.watchedCount} watched · ${profile.ratedCount} rated`;
  field(section, 'films').append(...profile.topRated.map(renderFilm));

  const hiddenCount = profile.topRatedCount - profile.topRated.length;
  if (hiddenCount > 0) {
    field(section, 'more').textContent = `and ${hiddenCount} more`;
    field(section, 'more').hidden = false;
  }

  setUpNetflix(section, slot, profile);
  field(section, 'remove').addEventListener('click', () => startRemoval(slot));
  return section;
}

function renderSlot(slot) {
  if (profiles[slot]) return [renderProfile(slot, profiles[slot])];
  if (slot === 0) return [renderUpload(0)];
  if (!profiles[0]) return [];
  return [addingSecondPerson ? renderUpload(1) : renderInvite()];
}

function renderPeople() {
  people.replaceChildren(...renderSlot(0), ...renderSlot(1));
  toTonight.disabled = filledCount() === 0;
  servicesLegend.textContent = filledCount() === 2 ? 'Services you share' : 'Your services';
  updateSteps(currentStep());
}

// Tonight
function readChoices() {
  const formData = new FormData(finderForm);
  return {
    services: formData.getAll('services'),
    region: formData.get('region'),
    mood: formData.get('mood'),
  };
}

function loadSavedChoices() {
  try {
    return JSON.parse(localStorage.getItem(CHOICES_STORAGE_KEY)) ?? {};
  } catch (error) {
    return {};
  }
}

function saveChoices(choices) {
  try {
    localStorage.setItem(CHOICES_STORAGE_KEY, JSON.stringify(choices));
  } catch (error) {
    // Remembering choices is only a convenience, so the app works without it.
  }
}

function updateFinder() {
  const hasService = readChoices().services.length > 0;
  finderButton.disabled = !hasService;
  finderHint.hidden = hasService;
}

function renderChoice(type, name, value, checked, ...content) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  const face = document.createElement('span');
  input.type = type;
  input.name = name;
  input.value = value;
  input.checked = checked;
  face.append(...content);
  label.append(input, face);
  return label;
}

function renderMood(mood, checked) {
  const title = document.createElement('strong');
  const note = document.createElement('small');
  title.textContent = mood.name;
  note.textContent = MOOD_NOTES[mood.id];
  const label = renderChoice('radio', 'mood', mood.id, checked, title, note);
  label.className = 'mood';
  return label;
}

async function setUpFinder() {
  const options = await api('/api/options');
  const saved = loadSavedChoices();
  const savedMood = options.moods.some(({ id }) => id === saved.mood) ? saved.mood : 'either';

  serviceOptions.replaceChildren(...options.services.map((service) => {
    const label = renderChoice('checkbox', 'services', service.id, Boolean(saved.services?.includes(service.id)), service.name);
    label.className = 'chip';
    return label;
  }));
  moodOptions.replaceChildren(...options.moods.map((mood) => renderMood(mood, mood.id === savedMood)));
  region.replaceChildren(...options.regions.map((code) => new Option(code, code)));
  if (options.regions.includes(saved.region)) region.value = saved.region;

  updateFinder();
  finderForm.addEventListener('change', updateFinder);
  finderForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const choices = readChoices();
    saveChoices(choices);
    buildShortlist(choices);
  });
}

// Shortlist
function showPanel(panel) {
  for (const candidate of [loading, failure, results]) candidate.hidden = candidate !== panel;
  focusHeading(panel);
}

function startLoadingMessages() {
  let index = 0;
  loadingStatus.textContent = LOADING_MESSAGES[0];
  loadingTimer = setInterval(() => {
    index = Math.min(index + 1, LOADING_MESSAGES.length - 1);
    loadingStatus.textContent = LOADING_MESSAGES[index];
  }, LOADING_MESSAGE_MS);
}

function visiblePicks() {
  return [...resultsList.children].filter((item) => !item.hidden);
}

function updatePicksHeading() {
  const total = resultsList.children.length;
  const remaining = visiblePicks().length;
  const vetoed = total - remaining;

  restorePicks.hidden = vetoed === 0;
  restorePicks.textContent = vetoed === 1 ? 'Bring back 1 pick' : `Bring back ${vetoed} picks`;

  if (remaining === 0) resultsHeading.textContent = 'None of these tonight';
  else if (remaining === 1 && vetoed > 0) resultsHeading.textContent = 'Your pick for tonight';
  else resultsHeading.textContent = "Today's Shortlist";
}

function renderPick(pick) {
  const item = cloneTemplate('pick-template');
  field(item, 'title').textContent = `${pick.title} (${pick.year})`;
  field(item, 'why').textContent = pick.why;
  field(item, 'facts').textContent = [`On ${pick.services.join(', ')}`, pick.runtime && `${pick.runtime} min`]
    .filter(Boolean)
    .join(' · ');
  field(item, 'genres').textContent = pick.genres.join(', ');
  field(item, 'overview').textContent = pick.overview;

  if (pick.label) {
    field(item, 'label').textContent = pick.label;
    field(item, 'label').hidden = false;
  }
  if (pick.posterPath) {
    field(item, 'poster').src = `${POSTER_BASE_URL}${pick.posterPath}`;
    field(item, 'poster').alt = `Poster for ${pick.title}`;
    field(item, 'poster').hidden = false;
  }

  field(item, 'veto').addEventListener('click', () => {
    item.hidden = true;
    updatePicksHeading();
    resultsHeading.focus({ preventScroll: true });
  });
  return item;
}

function showResults({ picks, candidateCount, stats }) {
  const watched = stats.watchedOnLetterboxd + stats.watchedOnNetflix;
  resultsSummary.textContent = picks.length > 0
    ? `Chosen from ${candidateCount} films on your services. Skipped ${watched} you've already watched.`
    : `Checked ${stats.checked} films and none are on your services. Try adding another service.`;
  resultsList.replaceChildren(...picks.map(renderPick));
  updatePicksHeading();
  if (picks.length === 0) resultsHeading.textContent = 'Nothing to pick from tonight';
  showPanel(results);
}

async function buildShortlist(choices) {
  lastChoices = choices;
  hasShortlist = true;
  showStep('shortlist');
  showPanel(loading);
  startLoadingMessages();

  try {
    await finishRemoval();
    showResults(await api('/api/shortlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(choices),
    }));
  } catch (error) {
    failureMessage.textContent = error.message;
    showPanel(failure);
  } finally {
    clearInterval(loadingTimer);
  }
}

function setUpNavigation() {
  for (const link of document.querySelectorAll('[data-step-link]')) {
    link.addEventListener('click', () => goToStep(link.dataset.stepLink));
  }
  for (const button of document.querySelectorAll('[data-go-to]')) {
    button.addEventListener('click', () => goToStep(button.dataset.goTo));
  }
  toTonight.addEventListener('click', () => goToStep('tonight'));
  document.getElementById('try-again').addEventListener('click', () => buildShortlist(lastChoices));
  restorePicks.addEventListener('click', () => {
    for (const item of resultsList.children) item.hidden = false;
    updatePicksHeading();
    resultsHeading.focus({ preventScroll: true });
  });

  // Leaving the page ends the Undo window, so the removal still has to reach the server.
  window.addEventListener('pagehide', () => {
    if (pendingRemoval) fetch(`/api/profiles/${pendingRemoval.slot}`, { method: 'DELETE', keepalive: true });
  });
}

async function start() {
  setUpNavigation();
  try {
    await setUpFinder();
    profiles = (await api('/api/profiles')).profiles;
  } catch (error) {
    showStep('you');
    showToast(error.message);
    return;
  }
  // Someone returning with a profile is ready to choose tonight's film.
  showStep(filledCount() > 0 ? 'tonight' : 'you');
  renderPeople();
}

start();
