
function goStep(step) {
  // Hide all steps
  document.getElementById('submitStep1').style.display = 'none';
  document.getElementById('submitStep2').style.display = 'none';
  document.getElementById('submitStep3').style.display = 'none';
  document.getElementById('submitSuccess').style.display = 'none';

  // Show target step
  const target = document.getElementById('submitStep' + step);
  if (target) ltarget.style.disp lay = 'block';

  // Update step indicators
  for (let i = 1; i <= 3; i++) {
    const item = document.getElementById('step' + i + '-item');
    const line = document.getElementById('line-' + i + '-' + (i + 1));
    
    if (i < step) {
      item.classList.add('done');
      item.classList.remove('active');
      if (line) line.classList.add('done');
    } else if (i === step) {
      item.classList.add('active');
      item.classList.remove('done');
      if (line) line.classList.remove('done');
    } else {
      item.classList.remove('active', 'done');
      if (line) line.classList.remove('done');
    }
  }

  // If going to step 3, populate review grid
  if (step === 3) {
    const grid = document.getElementById('reviewGrid');
    const file = document.getElementById('fileInput').files[0];
    const fields = [
      ['Agent Name', document.getElementById('sub_agentName').value],
      ['Agent ID', document.getElementById('sub_agentId').value],
      ['Email', document.getElementById('sub_email').value],
      ['Applicants', document.getElementById('sub_count').value],
      ['File Name', file ? file.name : 'No file selected'],
      ['Notes', document.getElementById('sub_notes').value || 'None']
    ];
    grid.innerHTML = fields.map(([k,v]) => `
      <div style="padding:12px;background:var(--off-white);border-radius:8px;border:1px solid var(--border-light)">
        <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${k}</div>
        <div style="font-size:14px;font-weight:500;color:var(--navy)">${v}</div>
      </div>`).join('');
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const preview = document.getElementById('filePreview');
  const nameEl = document.getElementById('filePreviewName');
  const sizeEl = document.getElementById('filePreviewSize');
  const nextBtn = document.getElementById('step1Next');

  nameEl.textContent = file.name;
  sizeEl.textContent = (file.size / 1024).toFixed(1) + ' KB';
  preview.classList.add('show');
  nextBtn.disabled = false;
}

function handleDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function handleDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length) {
    document.getElementById('fileInput').files = files;
    handleFileSelect({ target: { files: files } });
  }
}

function removeFile() {
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('step1Next').disabled = true;
}

function resetSubmit() {
  document.getElementById('fileInput').value = '';
  document.getElementById('sub_agentName').value = DB.currentUser || '';
  document.getElementById('sub_agentId').value = '';
  document.getElementById('sub_email').value = DB.currentEmail || '';
  document.getElementById('sub_count').value = '';
  document.getElementById('sub_notes').value = '';
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('step1Next').disabled = true;
  goStep(1);
}
