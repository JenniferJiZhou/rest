param(
    [string]$BaseUrl = "http://127.0.0.1:3000",
    [ValidateSet("Normal", "Demo")]
    [string]$Mode = "Normal",
    [string]$DemoToken = "",
    [ValidateSet(
        "All",
        "IOSApp",
        "MacApp",
        "MacWebsiteUser",
        "MacWebsiteDomain"
    )]
    [string]$Payload = "All"
)

$ErrorActionPreference = "Stop"
$ContractVersion = "1.0"
$ClientVersion = "1.0.0-apple-smoke"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot

if ($Mode -eq "Demo" -and [string]::IsNullOrWhiteSpace($DemoToken)) {
    throw "Demo mode requires -DemoToken. The token value is never printed."
}

$fixtureByPayload = [ordered]@{
    IOSApp          = "usage-summary-device-activity-ios.json"
    MacApp          = "usage-summary-macos-app.json"
    MacWebsiteUser  = "usage-summary-macos-website-user-label.json"
    MacWebsiteDomain = "usage-summary-macos-website.json"
}

function Get-ResponseHeader {
    param(
        [Parameter(Mandatory = $true)]
        $Headers,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $value = $Headers[$Name]
    if ($value -is [System.Array]) {
        return $value -join ","
    }
    return [string]$value
}

function Invoke-AppleRestDecision {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PayloadName,
        [Parameter(Mandatory = $true)]
        [string]$FixtureName
    )

    $fixturePath = Join-Path `
        $RepositoryRoot `
        "contracts\fixtures\$FixtureName"
    $body = Get-Content -Raw -Encoding UTF8 -LiteralPath $fixturePath |
        ConvertFrom-Json
    $requestId = "req_smoke_$($PayloadName.ToLowerInvariant())_$(
        [guid]::NewGuid().ToString("N")
    )"
    $body.request_id = $requestId

    $headers = @{
        "X-Request-ID"       = $requestId
        "X-Client-Version"   = $ClientVersion
        "X-Contract-Version" = $ContractVersion
    }
    if ($Mode -eq "Demo") {
        $headers["X-Hush-Demo-Token"] = $DemoToken
    }

    $endpoint = "$($BaseUrl.TrimEnd('/'))/v1/rest/evaluate"
    try {
        $response = Invoke-WebRequest `
            -Method Post `
            -Uri $endpoint `
            -Headers $headers `
            -ContentType "application/json" `
            -Body ($body | ConvertTo-Json -Depth 12 -Compress) `
            -UseBasicParsing
    } catch {
        $status = "network_or_unknown"
        if ($null -ne $_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        throw "$PayloadName failed with HTTP status $status (request_id=$requestId)."
    }

    $result = $response.Content | ConvertFrom-Json
    $responseRequestId = Get-ResponseHeader `
        -Headers $response.Headers `
        -Name "X-Request-ID"
    $responseContract = Get-ResponseHeader `
        -Headers $response.Headers `
        -Name "X-Contract-Version"
    $responseOrigin = Get-ResponseHeader `
        -Headers $response.Headers `
        -Name "X-Hush-Data-Origin"

    if ($responseRequestId -ne $requestId) {
        throw "$PayloadName returned a mismatched X-Request-ID."
    }
    if ($responseContract -ne $ContractVersion) {
        throw "$PayloadName returned an invalid X-Contract-Version."
    }
    if ($responseOrigin -notin @("real", "mock", "cached")) {
        throw "$PayloadName returned an invalid X-Hush-Data-Origin."
    }
    if ($result.request_id -ne $requestId) {
        throw "$PayloadName returned a mismatched body request_id."
    }

    Write-Host "payload=$PayloadName"
    Write-Host "status=$([int]$response.StatusCode)"
    Write-Host "request_id=$($result.request_id)"
    Write-Host "should_offer_rest=$($result.should_offer_rest)"
    Write-Host "message=$($result.message)"
    Write-Host "data_origin=$responseOrigin"
}

$selected = if ($Payload -eq "All") {
    $fixtureByPayload.GetEnumerator()
} else {
    @(
        [PSCustomObject]@{
            Key = $Payload
            Value = $fixtureByPayload[$Payload]
        }
    )
}

foreach ($entry in $selected) {
    Invoke-AppleRestDecision `
        -PayloadName $entry.Key `
        -FixtureName $entry.Value
}

Write-Host "Apple Rest Decision smoke passed."
