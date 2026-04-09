// Shared form-field builder for fal.ai models defined in src/main/models.json.
// Used by both the Models page and the Editor's remix sub-page so a single
// model definition drives both UIs.

import { el, esc } from './dom.js';

// Build a form field for a single model input. `state` is an object with
// `inputs` (name -> value) and `localFiles` (name -> absolute path, for
// image fields). Both are mutated in place as the user edits the form.
export function buildField(input, state) {
  const field = el(`<label class="field"><span class="label">${esc(input.label)}${
    input.required ? ' *' : ''
  }</span></label>`);

  let control;
  const defaultVal = state.inputs[input.name] ?? input.default;

  switch (input.type) {
    case 'textarea':
      control = el(
        `<textarea placeholder="${esc(input.placeholder || '')}">${esc(defaultVal ?? '')}</textarea>`
      );
      control.addEventListener('input', () => {
        state.inputs[input.name] = control.value;
      });
      break;
    case 'number':
      control = el(
        `<input type="number" ${input.min != null ? `min="${input.min}"` : ''} ${
          input.max != null ? `max="${input.max}"` : ''
        } ${input.step != null ? `step="${input.step}"` : ''} value="${
          defaultVal != null ? esc(defaultVal) : ''
        }" placeholder="${esc(input.placeholder || '')}" />`
      );
      control.addEventListener('input', () => {
        const v = control.value;
        state.inputs[input.name] = v === '' ? undefined : Number(v);
      });
      break;
    case 'select': {
      control = document.createElement('select');
      // Map stringified value -> original-typed value so we can preserve types
      // (e.g. esrgan.scale is 2|4 as numbers, kling.duration is "5"|"10" as strings).
      const optionMap = new Map();
      for (const opt of input.options || []) {
        const o = document.createElement('option');
        o.value = String(opt);
        o.textContent = String(opt);
        optionMap.set(String(opt), opt);
        if (String(defaultVal) === String(opt)) o.selected = true;
        control.appendChild(o);
      }
      if (state.inputs[input.name] == null && defaultVal != null) {
        state.inputs[input.name] = optionMap.get(String(defaultVal)) ?? defaultVal;
      }
      control.addEventListener('change', () => {
        state.inputs[input.name] = optionMap.get(control.value) ?? control.value;
      });
      break;
    }
    case 'boolean': {
      const wrap = el(`<div class="checkbox-row"></div>`);
      control = el(`<input type="checkbox" />`);
      control.checked = !!defaultVal;
      if (state.inputs[input.name] == null) state.inputs[input.name] = !!defaultVal;
      control.addEventListener('change', () => {
        state.inputs[input.name] = control.checked;
      });
      wrap.appendChild(control);
      wrap.appendChild(document.createTextNode(' Enabled'));
      field.appendChild(wrap);
      return field;
    }
    case 'image': {
      const pick = el(`
        <div class="image-pick">
          <div class="file-pick">
            <div class="path">${esc(state.localFiles[input.name] || 'No file selected')}</div>
            <button class="btn">Browse…</button>
          </div>
          <div class="thumbs"></div>
        </div>
      `);
      const thumbs = pick.querySelector('.thumbs');
      const renderThumb = (src) => {
        thumbs.innerHTML = '';
        if (!src) return;
        const t = el(`<div class="thumb"><img alt="preview"/></div>`);
        t.querySelector('img').src = src;
        thumbs.appendChild(t);
      };
      if (state.inputs[input.name]) renderThumb(state.inputs[input.name]);
      pick.querySelector('button').addEventListener('click', async () => {
        const p = await window.api.dialog.pickImage();
        if (!p) return;
        state.localFiles[input.name] = p;
        const dataUrl = await window.api.library.readPathAsDataUrl(p);
        state.inputs[input.name] = dataUrl;
        pick.querySelector('.path').textContent = p;
        renderThumb(dataUrl);
      });
      field.appendChild(pick);
      return field;
    }
    case 'image_array': {
      const existing = Array.isArray(state.localFiles[input.name])
        ? state.localFiles[input.name]
        : [];
      const labelText = existing.length
        ? `${existing.length} file${existing.length === 1 ? '' : 's'} selected`
        : 'No files selected';
      const pick = el(`
        <div class="image-pick">
          <div class="file-pick">
            <div class="path">${esc(labelText)}</div>
            <button class="btn">Browse…</button>
          </div>
          <div class="thumbs"></div>
        </div>
      `);
      const thumbs = pick.querySelector('.thumbs');
      const renderThumbs = (srcs) => {
        thumbs.innerHTML = '';
        for (const src of srcs || []) {
          if (!src) continue;
          const t = el(`<div class="thumb"><img alt="preview"/></div>`);
          t.querySelector('img').src = src;
          thumbs.appendChild(t);
        }
      };
      if (Array.isArray(state.inputs[input.name])) {
        renderThumbs(state.inputs[input.name]);
      }
      pick.querySelector('button').addEventListener('click', async () => {
        const paths = await window.api.dialog.pickImages();
        if (!paths || !paths.length) return;
        state.localFiles[input.name] = paths;
        const dataUrls = [];
        for (const p of paths) {
          dataUrls.push(await window.api.library.readPathAsDataUrl(p));
        }
        state.inputs[input.name] = dataUrls;
        pick.querySelector('.path').textContent = `${paths.length} file${
          paths.length === 1 ? '' : 's'
        } selected`;
        renderThumbs(dataUrls);
      });
      field.appendChild(pick);
      return field;
    }
    default:
      control = el(
        `<input type="text" value="${esc(defaultVal ?? '')}" placeholder="${esc(
          input.placeholder || ''
        )}" />`
      );
      control.addEventListener('input', () => {
        state.inputs[input.name] = control.value;
      });
  }
  field.appendChild(control);
  return field;
}

// Merge state.inputs over model defaults, returning an object ready to send
// to fal.ai. Throws if any required field is missing.
export function collectInputs(model, state) {
  const input = {};
  for (const inp of model.inputs || []) {
    let v = state.inputs[inp.name];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) v = inp.default;
    if (v === undefined) continue;
    input[inp.name] = v;
  }
  for (const inp of model.inputs || []) {
    const val = input[inp.name];
    const missing = val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
    if (inp.required && missing) {
      const err = new Error(`Missing required field: ${inp.label}`);
      err.field = inp.name;
      throw err;
    }
  }
  return input;
}
