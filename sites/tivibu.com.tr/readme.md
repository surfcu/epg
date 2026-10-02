# tivibu.com.tr

https://www.tivibu.com.tr/canli-tv

### Download the guide

```sh
npm run grab --- --site=tivibu.com.tr
```

### Update channel list

```sh
npm run channels:parse --- --config=./sites/tivibu.com.tr/tivibu.com.tr.config.js --output=./sites/tivibu.com.tr/tivibu.com.tr.channels.xml
```

### Test

```sh
npm test --- tivibu.com.tr
```

### Notes

- Each request searches by the channel's name in `channels.xml`, so keep the names as the site spells them. If a name doesn't match, the config falls back to downloading the whole day once and reuses it for every channel.
- The site does not return programme descriptions.
