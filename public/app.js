const SLOT_HEADINGS = ['You', 'Second person (optional)'];

const people = document.getElementById('people');
const mode = document.getElementById('mode');
const finder = document.getElementById('finder');
const finderForm = document.getElementById('finder-form');
const finderButton = document.getElementById('finder-button');
const serviceOptions = document.getElementById('service-options');
const region = document.getElementById('region');
const results = document.getElementById('results');
const resultsHeading = document.getElementById('results-heading');
const resultsSummary = document.getElementById('results-summary');
const resultsList = document.getElementById('results-list');

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

async function sendProfiles(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body.profiles;
}

function renderUpload(slot) {
  const section = cloneTemplate('upload-template');
  field(section, 'heading').textContent = SLOT_HEADINGS[slot];

  const form = section.querySelector('form');
  const button = form.querySelector('button');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    field(section, 'error').hidden = true;
    button.disabled = true;
    button.textContent = 'Reading…';

    try {
      render(await sendProfiles(`/api/profiles/${slot}`, {
        method: 'POST',
        body: new FormData(form),
      }));
    } catch (error) {
      showError(section, error.message);
      button.disabled = false;
      button.textContent = 'Add';
    }
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
      render(await sendProfiles(`/api/profiles/${slot}/netflix`, {
        method: 'POST',
        body: formData,
      }));
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
  field(section, 'watchlist').textContent = profile.watchlistCount;
  field(section, 'watched').textContent = profile.watchedCount;
  field(section, 'rated').textContent = profile.ratedCount;
  field(section, 'films').append(...profile.topRated.map(renderFilm));

  const hiddenCount = profile.topRatedCount - profile.topRated.length;
  if (hiddenCount > 0) {
    field(section, 'more').textContent = `and ${hiddenCount} more`;
    field(section, 'more').hidden = false;
  }

  setUpNetflix(section, slot, profile);

  field(section, 'remove').addEventListener('click', async () => {
    render(await sendProfiles(`/api/profiles/${slot}`, { method: 'DELETE' }));
  });

  return section;
}

function describeSource(source) {
  return source.type === 'watchlist'
    ? `On ${source.person}'s watchlist`
    : `Because ${source.person} loved ${source.because}`;
}

function renderCandidate(film) {
  const item = document.createElement('li');
  const details = document.createElement('div');
  const title = document.createElement('span');
  const services = document.createElement('p');
  const source = document.createElement('p');
  const runtime = document.createElement('span');

  title.textContent = `${film.title} (${film.year})`;
  services.textContent = film.services.join(', ');
  services.className = 'film-note';
  source.textContent = film.sources.slice(0, 2).map(describeSource).join(' · ');
  source.className = 'film-note';
  runtime.textContent = film.runtime ? `${film.runtime} min` : '';
  runtime.className = 'rating';

  details.append(title, services, source);
  item.append(details, runtime);
  return item;
}

function showResults({ candidates, stats }) {
  const watched = stats.watchedOnLetterboxd + stats.watchedOnNetflix;
  resultsHeading.textContent = `${candidates.length} candidates`;
  resultsSummary.textContent =
    `Checked ${stats.checked} films: ${stats.notAvailable} not on your services. ` +
    `Skipped ${watched} already watched and ${stats.unmatched} TMDB couldn't match.`;
  resultsList.replaceChildren(...candidates.map(renderCandidate));
  results.hidden = false;
}

async function setUpFinder() {
  const response = await fetch('/api/options');
  const options = await response.json();

  serviceOptions.replaceChildren(...options.services.map((service) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'services';
    checkbox.value = service.id;
    label.className = 'service';
    label.append(checkbox, service.name);
    return label;
  }));

  region.replaceChildren(...options.regions.map((code) => new Option(code, code)));

  finderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    field(finder, 'error').hidden = true;
    results.hidden = true;
    finderButton.disabled = true;
    finderButton.textContent = 'Searching… this can take a minute';

    try {
      const formData = new FormData(finderForm);
      const reply = await fetch('/api/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          services: formData.getAll('services'),
          region: formData.get('region'),
        }),
      });
      const body = await reply.json();
      if (!reply.ok) throw new Error(body.error);
      showResults(body);
    } catch (error) {
      showError(finder, error.message);
    } finally {
      finderButton.disabled = false;
      finderButton.textContent = 'Find candidates';
    }
  });
}

function render(profiles) {
  const filled = profiles.filter(Boolean).length;
  finder.hidden = filled === 0;
  results.hidden = true;
  mode.textContent = ['Add your export to begin.', 'Solo mode', 'Blend mode'][filled];
  people.replaceChildren(
    ...profiles.map((profile, slot) => (profile ? renderProfile(slot, profile) : renderUpload(slot))),
  );
}

setUpFinder();
sendProfiles('/api/profiles').then(render);
