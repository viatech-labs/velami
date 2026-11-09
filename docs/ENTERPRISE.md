# Velami for organizations: policy and dictionary via MDM

Velami reads an organization policy from `chrome.storage.managed`. The browser fills it from the
same channels as any Chrome policy: Google Admin console, Group Policy or Intune on Windows, a
configuration profile on macOS, a JSON file on Linux. The user cannot change what the policy sets.
Nothing is sent to Via-Tech: the policy is applied on the computer, like the rest of Velami.

The schema is `managed-schema.json` in the package. In the examples `<VELAMI_ID>` is the extension
ID from the Chrome Web Store listing.

## Keys

| Key | Type | Effect |
|---|---|---|
| `organization` | string | Shown as "Managed by …" in the popup |
| `supportContact` | string | E-mail, phone or intranet link shown when the policy blocks a file |
| `enabled` | boolean | `true` keeps protection always on |
| `rehydrate` | boolean | Real values shown in answers |
| `model` | boolean | Local name and address model. `false` for computers with little memory |
| `askImages` | boolean | Ask before sending images |
| `language` | `auto`, `en`, `it`, `ru` | Interface language |
| `dictionary` | list of `{ term, type }` | Terms always hidden: client names, projects, internal codes. `type` is `PERSON`, `ORG`, `ADDRESS` or `CUSTOM`. Added to the personal dictionary, the user cannot remove them. Up to 5000 terms |
| `allowExclusions` | boolean | `false`: the user cannot untick a found value, everything found is always hidden |
| `allowOriginalFiles` | boolean | `false`: a PDF or Office file with personal data can go only as the clean text copy |
| `allowUncheckedFiles` | boolean | `false`: scans, images, password protected and unknown files are not sent |

A key that is not set stays the user's choice. Values of the wrong type are ignored. The `allow…`
keys default to `true`.

Typical strict policy for a small office:

```json
{
  "organization": "Studio Bianchi",
  "supportContact": "it@studio-bianchi.it",
  "enabled": true,
  "allowExclusions": false,
  "allowOriginalFiles": false,
  "allowUncheckedFiles": false,
  "dictionary": [
    { "term": "Bianchi Holding", "type": "ORG" },
    { "term": "Progetto Fenice", "type": "CUSTOM" }
  ]
}
```

## Install for everyone

Force install with the `ExtensionInstallForcelist` policy, value `<VELAMI_ID>;https://clients2.google.com/service/update2/crx`.
Users then cannot remove or disable the extension.

## Google Admin console

Devices → Chrome → Apps and extensions → Users and browsers → select the organizational unit →
add Velami from the Chrome Web Store → Installation policy "Force install" → in "Policy for
extensions" paste the JSON above.

## Windows (Group Policy, Intune, registry)

Chrome reads extension policy from
`HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<VELAMI_ID>\policy`.
Lists become subkeys numbered from 1. File `velami.reg`:

```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<VELAMI_ID>\policy]
"organization"="Studio Bianchi"
"supportContact"="it@studio-bianchi.it"
"enabled"=dword:00000001
"allowExclusions"=dword:00000000
"allowOriginalFiles"=dword:00000000
"allowUncheckedFiles"=dword:00000000

[HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<VELAMI_ID>\policy\dictionary\1]
"term"="Bianchi Holding"
"type"="ORG"

[HKEY_LOCAL_MACHINE\Software\Policies\Google\Chrome\3rdparty\extensions\<VELAMI_ID>\policy\dictionary\2]
"term"="Progetto Fenice"
"type"="CUSTOM"
```

In Intune the same keys go through a custom OMA-URI profile or a PowerShell script that writes
them. Microsoft Edge installs Velami from the Chrome Web Store too, its path is
`HKEY_LOCAL_MACHINE\Software\Policies\Microsoft\Edge\3rdparty\extensions\<VELAMI_ID>\policy`.

## macOS (Jamf, Kandji, Mosyle, any MDM)

Configuration profile for the `com.google.Chrome` domain, key `3rdparty`:

```xml
<key>3rdparty</key>
<dict>
  <key>extensions</key>
  <dict>
    <key><VELAMI_ID></key>
    <dict>
      <key>organization</key><string>Studio Bianchi</string>
      <key>supportContact</key><string>it@studio-bianchi.it</string>
      <key>enabled</key><true/>
      <key>allowExclusions</key><false/>
      <key>allowOriginalFiles</key><false/>
      <key>allowUncheckedFiles</key><false/>
      <key>dictionary</key>
      <array>
        <dict><key>term</key><string>Bianchi Holding</string><key>type</key><string>ORG</string></dict>
        <dict><key>term</key><string>Progetto Fenice</string><key>type</key><string>CUSTOM</string></dict>
      </array>
    </dict>
  </dict>
</dict>
```

## Linux

File `/etc/opt/chrome/policies/managed/velami.json`:

```json
{ "3rdparty": { "extensions": { "<VELAMI_ID>": { "organization": "Studio Bianchi", "enabled": true } } } }
```

## Check

`chrome://policy` lists the Velami policy under the extension ID, with errors if a value does not
match the schema. In Velami the popup shows "Managed by Studio Bianchi", the locked switches are
greyed out, and the dictionary page shows the organization terms without a delete button. Policy
changes apply without restarting the browser.

## What the policy does not do

The log and the vault stay on each computer, there is no central console or report. Optional sites
(Copilot, DeepSeek, Mistral, Grok) are still switched on by the user, because Chrome asks the user
for the site permission. Both are possible next steps if an organization needs them.
