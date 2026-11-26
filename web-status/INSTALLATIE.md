# HUSS HQ live dashboard — PHP-hosting

## 1. Website uploaden

Maak een map `status` op je website en upload index.html, style.css,
dashboard.js, api.php en config.example.php daarin. Gebruik HTTPS en een
ondersteunde PHP-versie (bij voorkeur PHP 8.x). De map moet door PHP
beschrijfbaar zijn: de API maakt daarin zelf snapshot.php aan.

Kopieer config.example.php naar config.php. Genereer op de botcomputer een token:

    node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

Vervang de placeholder in config.php door dit token. Deel dit token niet en
plaats het nooit in dashboard.js of index.html. De website is publiek leesbaar;
alleen de bot met dit token kan statusupdates insturen.

## 2. Bot instellen

De nieuwe botmodule staat in features/web-status.js. De bestaande featureloader
laadt deze automatisch. Als je bot elders draait: upload ook deze module naar
zijn features-map. Voeg deze regels toe aan de .env van de bot:

    STATUS_PUSH_URL=https://jouwdomein.be/status/api.php
    STATUS_PUSH_TOKEN=hetzelfde_token_als_in_config_php
    STATUS_GUILD_ID=je_discord_server_id

Gebruik de definitieve HTTPS-URL zonder redirects. De server-ID vind je via
Discord developer mode: rechtsklik op de server en kopieer de server-ID.
Gebruik de ID van de server waarvan je de functie- en onderhoudsstatus wilt tonen.
Herstart de bot (bij PM2: `pm2 restart huss-hq-bot`). Node.js 22.12+ is nodig,
zoals ook voor de bestaande bot. Geen extra npm-pakketten nodig.

## 3. Controleren

Open https://jouwdomein.be/status/ . Binnen circa 15 seconden verschijnen gegevens.
Stop de bot tijdelijk: na maximaal circa 75 seconden moet de pagina aangeven
dat de bot niet bereikbaar is. Herstart en controleer dat de status terugkomt.
Een verbroken Discord-verbinding wordt ook gemeld als het botproces nog draait.

De website toont dezelfde publieke statusgegevens als /botstatus, geen tokens,
ledenlijsten, berichtinhoud of private foutdetails. De functienamen volgen het
bestaande Engelstalige Discord-paneel. De ontvangsttijd wordt op de webserver
vastgelegd. Zorg dat de klok op de hosting correct staat.

Bij problemen: controleer HTTPS, PHP, schrijfrechten, server-ID en gelijke tokens.
Controleer de botlogs op [Web status]. Sluit api.php uit van eventuele CDN-cache.
Upload nooit .env, psw.txt of de volledige botmap naar je publieke webhosting.
Bewaar config.php en snapshot.php bij latere dashboard-updates.

Uitval van de hele website kan deze website zelf niet melden. Daarvoor is een
afzonderlijke uptime-monitor nodig.

## Statusbalken en geschiedenis

Overall service toont 90 UTC-kalenderdagen met één blokje per dag. De overige
onderdelen behouden 24 uurblokken. Beide reeksen staan in snapshot.php.
Bij de upgrade worden bestaande echte uurmetingen eenmalig samengevat voor
de overall-dagbalken. Ontbrekende eerdere dagen blijven grijs.

Upload bij de upgrade index.html, style.css, dashboard.js en api.php opnieuw.
Behoud de bestaande config.php en snapshot.php. De botmodule hoeft niet te wijzigen.

De API bewaart maximaal 24 UTC-uurblokken (het huidige uur en de 23 voorgaande uren) in snapshot.php. Elk blokje toont
de zwaarste ontvangen status van dat uur per onderdeel. Uren zonder data zijn
grijs; periodes van meer dan 60 seconden zonder update worden gestreept getoond
(of rood als ook onbeschikbaarheid gemeten is). Details staan onder de balken
wanneer je een blokje selecteert; navigeren kan ook met de pijltjestoetsen.

Geschiedenis begint bij de eerste update na deze upgrade. Oude uren worden
niet als online ingevuld. Groen betekent dat ontvangen metingen operationeel
waren, niet dat alle seconden van het uur zijn gecontroleerd. Daarom wordt geen
misleidend uptimepercentage berekend. De laatste 24 uurblokken worden automatisch
bewaard en opgeschoond bij ontvangen updates; er is geen cronjob nodig.

Eerdere dagtotalen kunnen niet betrouwbaar naar uurmetingen worden omgezet.
De uurgeschiedenis begint daarom opnieuw na deze upgrade; de actuele botstatus
en je bestaande configuratie blijven behouden.
