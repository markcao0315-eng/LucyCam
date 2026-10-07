import {cropRect, outputSize} from './photo-utils.js';
const $ = id => document.getElementById(id);

export function setupAI({video, getCamera, setBusy, makePhoto}) {
  let configured = false, authenticated = false, loading = false, frame = null, result = null, controller = null, generation = 0;
  const message = text => {$('aiStatus').textContent = text;};
  function update() {
    const camera = getCamera();
    $('aiButton').disabled = !configured || !camera.ready || loading;
    $('aiButton').textContent = loading ? '正在分析…' : 'AI 构图';
  }
  async function refresh() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error();
      const status = await response.json();
      configured = status.features?.aiComposition === true;
      authenticated = status.authenticated === true;
      message(configured ? '点击上传当前一帧，由 Google AI 分析构图。' : 'AI 尚未配置。普通拍照可正常使用。');
    } catch {message('暂时无法连接 AI 后台，普通拍照仍可使用。');}
    update();
  }
  async function request(path, body, signal) {
    const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) authenticated = false;
      throw new Error(data.error || '请求失败，请重试。');
    }
    return data;
  }
  function snapshot() {
    const camera = getCamera();
    if (!camera.ready || !video.videoWidth) throw new Error('请先开启相机。');
    const rect = cropRect(video.videoWidth, video.videoHeight, camera.ratio);
    const size = outputSize(rect.sw, rect.sh);
    const canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (camera.mirrored) {ctx.translate(canvas.width, 0); ctx.scale(-1, 1);}
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
    const small = document.createElement('canvas');
    const scale = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
    small.width = Math.round(canvas.width * scale); small.height = Math.round(canvas.height * scale);
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    return {canvas, scene: camera.scene, image: small.toDataURL('image/jpeg', .8).split(',')[1]};
  }
  async function analyze() {
    if (loading) return;
    if (!authenticated) {
      $('accessStatus').textContent = '';
      $('accessDialog').showModal();
      return;
    }
    const token = ++generation;
    try {
      const captured = snapshot();
      frame = captured.canvas; result = null;
      loading = true; setBusy(true); update();
      message('正在分析这一帧… 通常需要几秒。');
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 32000);
      let data;
      try {data = await request('/api/compose', {image: captured.image, scene: captured.scene}, controller.signal);}
      finally {clearTimeout(timeout);}
      if (token !== generation) return;
      result = data.composition;
      const {centerX, centerY, scale} = result;
      $('aiReference').src = frame.toDataURL('image/jpeg', .85);
      const box = $('aiCropBox');
      box.style.left = `${(centerX - scale / 2) * 100}%`; box.style.top = `${(centerY - scale / 2) * 100}%`;
      box.style.width = `${scale * 100}%`; box.style.height = `${scale * 100}%`;
      $('aiAdvice').textContent = `${result.subject}：${result.advice}`;
      $('aiCropInfo').textContent = scale > .99 ? 'AI 建议保留当前画面。' : `绿色框为建议保留范围，约 ${(1 / scale).toFixed(2)}× 数字裁切。`;
      $('aiResultStatus').textContent = '';
      $('aiResultDialog').showModal();
      video.pause();
      message('建议已生成，可预览裁切或返回相机调整角度。');
    } catch (error) {
      if (token === generation) {frame = null; message(error.name === 'AbortError' ? '分析已取消或超时，请重试。' : error.message);}
    } finally {
      if (token === generation) {loading = false; controller = null; setBusy(false); update();}
    }
  }
  $('aiButton').onclick = analyze;
  $('closeAccess').onclick = () => $('accessDialog').close();
  $('accessForm').onsubmit = async event => {
    event.preventDefault();
    const input = $('accessCode');
    $('unlockAI').disabled = true; $('accessStatus').textContent = '正在验证…';
    try {
      await request('/api/session', {code: input.value}, AbortSignal.timeout(15000));
      authenticated = true; input.value = ''; $('accessDialog').close();
      message('已解锁。点击 AI 构图上传当前一帧。');
    } catch (error) {$('accessStatus').textContent = error.message || '验证失败，请重试。';}
    finally {$('unlockAI').disabled = false;}
  };
  $('closeAI').onclick = $('returnCamera').onclick = () => $('aiResultDialog').close();
  $('aiResultDialog').addEventListener('close', () => {
    frame = null; result = null; $('aiReference').removeAttribute('src');
    if (getCamera().active && !document.hidden && !$('photoDialog').open) video.play().catch(() => {});
  });
  $('saveAICrop').onclick = async () => {
    if (!frame || !result || loading) return;
    loading = true; setBusy(true); update(); $('saveAICrop').disabled = true;
    try {
      const cropped = document.createElement('canvas');
      cropped.width = Math.round(frame.width * result.scale); cropped.height = Math.round(frame.height * result.scale);
      cropped.getContext('2d').drawImage(frame, (result.centerX - result.scale / 2) * frame.width, (result.centerY - result.scale / 2) * frame.height,
        frame.width * result.scale, frame.height * result.scale, 0, 0, cropped.width, cropped.height);
      await makePhoto(cropped, cropped.width, cropped.height, {crop: false, kind: 'AI 裁切'});
      $('aiResultDialog').close();
    } catch (error) {$('aiResultStatus').textContent = error.message || '生成照片失败，请重试。';}
    finally {loading = false; setBusy(false); $('saveAICrop').disabled = false; update();}
  };
  function cancel() {
    generation++; controller?.abort(); controller = null;
    if (loading) {loading = false; setBusy(false); message('分析已中断，返回后可重新拍摄。');}
    if (!$('aiResultDialog').open) frame = null;
    update();
  }
  document.addEventListener('visibilitychange', () => {if (document.hidden) cancel();});
  window.addEventListener('pagehide', cancel);
  refresh();
  return {update, available: () => configured};
}
