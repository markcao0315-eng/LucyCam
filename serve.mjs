import {createAppServer} from './server.mjs';
createAppServer().listen(4173, '127.0.0.1', () => console.log('LucyCam preview: http://127.0.0.1:4173'));
