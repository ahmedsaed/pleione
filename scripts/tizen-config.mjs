// The Samsung Tizen widget manifest (dist-tizen/config.xml), written by the
// build. The package id is the app's permanent identity on Samsung TVs,
// together with the author certificate: never change it once it ships.
export const TIZEN_PACKAGE_ID = 'PleioneMrp';
export const TIZEN_APP_ID = `${TIZEN_PACKAGE_ID}.Pleione`;

const PRIVILEGES = [
  'http://tizen.org/privilege/internet',
  'http://tizen.org/privilege/tv.inputdevice',
];

export function tizenConfigXml(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Tizen needs an x.y.z version, got ${version}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="https://pleione.merope.dev/tizen" version="${version}" viewmodes="maximized">
  <tizen:application id="${TIZEN_APP_ID}" package="${TIZEN_PACKAGE_ID}" required_version="4.0"/>
  <tizen:profile name="tv-samsung"/>
  <content src="index.html"/>
  <icon src="icon.png"/>
  <name>Pleione</name>
  <access origin="*" subdomains="true"/>
${PRIVILEGES.map((p) => `  <tizen:privilege name="${p}"/>`).join('\n')}
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
</widget>
`;
}
