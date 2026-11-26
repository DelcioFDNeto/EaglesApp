import { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
	appId: 'app.eagles',
	appName: 'Eagles',
	webDir: 'build', // saída do adapter-static do SvelteKit
	server: {
		// Em desenvolvimento, aponta para a VPS (URL da API).
		// Em produção (APK instalado), o webview carrega do próprio dispositivo (build estático).
		// Apenas URLs externas de permissão, se necessário.
		cleartext: true
	},
	plugins: {
		SplashScreen: {
			launchShowDuration: 2000,
			backgroundColor: '#FBF7F6',
			androidSplashResourceName: 'splash',
			androidScaleType: 'CENTER_CROP'
		},
		StatusBar: {
			backgroundColor: '#A91825',
			style: 'LIGHT_CONTENT'
		},
		Keyboard: {
			resize: 'body',
			style: 'DARK'
		}
	}
};

export default config;
