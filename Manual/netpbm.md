# Netpbm and PFM formats

Import the format family explicitly and add it to a registry:

```ts
import { createRegistry } from "retro-img-handler";
import { netpbmPlugins } from "retro-img-handler/netpbm";

const registry = createRegistry(netpbmPlugins);
const image = await registry.decode(file, { filename: file.name });
```

`netpbmPlugins` contains five separately exported plugins:
`netpbmPbmPlugin`, `netpbmPgmPlugin`, `netpbmPpmPlugin`,
`netpbmPamPlugin`, and `netpbmPfmPlugin`. PFM is grouped here for convenience,
but it is not an official Netpbm format.

## PNM formats

PNM is the collective name for PBM, PGM, and PPM. Each plugin accepts the
format-specific extension and `.pnm`. The media types below are conventional;
none is registered with IANA.

| Format ID | Modes and magic | Samples | Conventional media type |
| --- | --- | --- | --- |
| `netpbm.pbm` | `plain` P1, `raw` P4 | one bit; 0 is white and 1 is black | `image/x-portable-bitmap` |
| `netpbm.pgm` | `plain` P2, `raw` P5 | grayscale, Maxval 1…65535 | `image/x-portable-graymap` |
| `netpbm.ppm` | `plain` P3, `raw` P6 | RGB, Maxval 1…65535 | `image/x-portable-pixmap` |

The plugins also list the conventional collective media type
`image/x-portable-anymap`. Detection uses the magic number rather than the
filename. Raw PBM pixels are read most-significant bit first and padding is
applied independently at the end of each row. PGM and PPM use one byte per
sample below Maxval 256 and big-endian two-byte samples otherwise.

Plain input accepts all Netpbm ASCII whitespace and `#` comments. Plain output
is canonical ASCII with sample lines no longer than 70 characters. Raw output
uses a minimal header. Decoded comments are available in
`document.metadata.netpbmComments` and are written back as canonical comment
lines; other header whitespace is not preserved byte for byte.

## PAM P7

`netpbm.pam` supports only the defined visual tuple types. Its extension is
`.pam` and its unregistered media type is `image/x-portable-arbitrarymap`.

| Mode ID | TUPLTYPE | Required depth | Maxval | Alpha |
| --- | --- | ---: | ---: | --- |
| `black-and-white` | `BLACKANDWHITE` | 1 | 1 | no |
| `black-and-white-alpha` | `BLACKANDWHITE_ALPHA` | 2 | 1 | yes |
| `grayscale` | `GRAYSCALE` | 1 | 1…65535 | no |
| `grayscale-alpha` | `GRAYSCALE_ALPHA` | 2 | 1…65535 | yes |
| `rgb` | `RGB` | 3 | 1…65535 | no |
| `rgb-alpha` | `RGB_ALPHA` | 4 | 1…65535 | yes |

PAM black-and-white values use 0 for black and 1 for white, the opposite of
PBM. Alpha is straight opacity: zero is transparent and Maxval is opaque. A
missing or unknown tuple type returns `UNSUPPORTED_MODE`; duplicate, missing,
or inconsistent header fields return `INVALID_FILE`. Arbitrary tuples and
extra channels are not interpreted or silently discarded. The P7 probe parses
the structured header so an xv thumbnail is not identified from its P7 prefix
alone.

## PFM

`netpbm.pfm` supports grayscale `Pf` and RGB `PF` with finite IEEE-754 Float32
samples. The signed scale header selects byte order; its absolute value is
retained as `scaleFactor`. The default row order is the Netpbm/GIMP
`bottom-up` convention. The indistinguishable Photoshop `top-down` convention
must be selected explicitly:

```ts
const image = await registry.decode(file, {
  pfm: {
    rowOrder: "top-down",
    exposure: 0,
    toneMapping: "reinhard"
  }
});
```

`DecodeOptions.pfm.exposure` is measured in stops and defaults to 0.
`toneMapping` is `reinhard` by default; `clip` clamps exposed linear values to
0…1. Preview generation multiplies a sample by
`abs(scaleFactor) * 2 ** exposure`, clips negative values to zero, tone maps,
then converts linear light to sRGB. Negative samples remain unchanged in
`samples` and add `PFM_NEGATIVE_PREVIEW_CLIPPED` with the affected count.
NaN and infinities return `INVALID_FILE` because they have no stable preview or
sample-value roundtrip.

Decoded PFM documents retain `byteOrder`, `rowOrder`, and `scaleFactor`.
`EncodeOptions.pfm` may override any of them. `scaleFactor` must be finite and
positive. Newly converted PFM documents default to little-endian, bottom-up,
and scale 1. PFM has no registered or specification-assigned media type in this
package.

## Direct sampled documents

All five plugins decode to `SampledRasterDocument` with
`kind: "sampled-raster"`; they never create a palette merely to fit direct
colors into `RasterDocument`.

Their registry modes likewise use `palette.model: "sampled-direct"` with zero
storable palette entries. `SampleCapability` identifies the native channel
model, unsigned-integer or Float32 storage, straight-alpha behavior, and Maxval
range. PFM capabilities additionally expose both byte orders, both supported
row interpretations, and preservation of the positive scale magnitude. These
targets never enter indexed median-cut or programmable-palette quantization.

- `IntegerSampledRasterDocument` uses `sampleType: "uint"`, a `Uint16Array`,
  `maxSampleValue`, `channelCount`, and `channelModel`.
- `FloatSampledRasterDocument` uses `sampleType: "float32"`, a
  `Float32Array`, `scaleFactor`, `byteOrder`, and `rowOrder`.
- `preview` is always displayable eight-bit RGBA. `palette` is an empty array
  for compatibility with the shared base document contract.

Integer PGM/PPM/PAM samples are interpreted with the normative BT.709 transfer
function and converted to sRGB for the browser preview. Native samples are not
changed by preview conversion. PGM transparency-mask semantics and common
linear or sRGB PNM variants cannot be identified from the file; the codecs
interpret them as normative image samples.

## Conversion and validation

`registry.convert` creates native sampled documents for every listed mode.
Input `RgbaImage` pixels are interpreted as sRGB. Grayscale uses BT.709 linear
luminance; PGM/PPM/PAM color samples are then encoded with the BT.709 transfer
function. PFM output keeps linear Float32 samples.

`ConversionOptions.maxSampleValue` defaults to 255 for integer grayscale and
color output and accepts integers from 1 through 65535. Bilevel output always
uses 1. Supplying this option for PFM returns `INVALID_OPTION`.

`none`, `bayer2`, `bayer4`, and `floyd-steinberg` dithering are available for
bilevel PBM and PAM targets. Requesting dithering for another direct target
returns `INVALID_OPTION`. Alpha-capable PAM modes retain straight alpha.
Targets without alpha reject a transparent input with `VALIDATION_FAILED`
unless an opaque `ConversionOptions.background` is supplied; composition then
occurs in linear light.

Encode validates the sampled document kind, channel layout, dimensions,
Maxval, sample count, and every sample range. Multi-image PNM/PAM streams are
valid in the wider specifications but are deliberately outside the single
document registry contract and return `UNSUPPORTED_SEQUENCE`. Truncated
rasters, extra bytes, numeric overflow, malformed headers, and samples above
Maxval return `INVALID_FILE`; configured input and pixel limits return
`LIMIT_EXCEEDED`.
