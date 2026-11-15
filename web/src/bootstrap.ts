export {};

let fragmentToken: string | null = null;
if (['/aktivasi', '/atur-ulang'].includes(location.pathname)) {
  fragmentToken = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(history.state, '', location.pathname);
}
const takeToken = () => { const token = fragmentToken; fragmentToken = null; return token; };
const { mount } = await import('./main.tsx');
mount(takeToken);
