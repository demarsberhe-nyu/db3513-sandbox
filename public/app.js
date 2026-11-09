const SLOT_HEADINGS = ['You', 'Second person (optional)'];

const people = document.getElementById('people');
const mode = document.getElementById('mode');

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

function render(profiles) {
  const filled = profiles.filter(Boolean).length;
  mode.textContent = ['Add your export to begin.', 'Solo mode', 'Blend mode'][filled];
  people.replaceChildren(
    ...profiles.map((profile, slot) => (profile ? renderProfile(slot, profile) : renderUpload(slot))),
  );
}

sendProfiles('/api/profiles').then(render);
