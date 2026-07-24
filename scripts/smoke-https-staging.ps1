[CmdletBinding()]
param(
    [string]$BaseUrl,
    [ValidateSet("Https", "LocalHttp")]
    [string]$Mode = "Https",
    [string]$DemoToken,
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 5,
    [ValidateSet("All", "iOS", "MacApp", "MacWebsite")]
    [string]$PayloadType = "All",
    [ValidateRange(100, 599)]
    [int]$ExpectedStatus = 200,
    [ValidateSet("real", "mock", "cached")]
    [string]$ExpectedDataOrigin = "mock"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    Write-Error "FAIL: $Message"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    Fail "BaseUrl must be supplied explicitly; no network request was made."
}

$parsedBaseUrl = $null
if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$parsedBaseUrl)) {
    Fail "BaseUrl must be an absolute URL."
}
if ($Mode -eq "Https" -and $parsedBaseUrl.Scheme -ne "https") {
    Fail "HTTPS smoke requires an https BaseUrl."
}
if ($Mode -eq "LocalHttp") {
    $localHosts = @("localhost", "127.0.0.1", "::1")
    if ($parsedBaseUrl.Scheme -ne "http" -or $parsedBaseUrl.Host -notin $localHosts) {
        Fail "LocalHttp mode accepts only loopback http URLs."
    }
}

Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
$base = $BaseUrl.TrimEnd("/")

function HeaderValue(
    [System.Net.Http.HttpResponseMessage]$Response,
    [string]$Name
) {
    $values = $null
    if (-not $Response.Headers.TryGetValues($Name, [ref]$values)) {
        Fail "response is missing $Name."
    }
    return @($values)[0]
}

function SendJson(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers,
    [object]$Payload
) {
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::new($Method),
        "$base$Path"
    )
    foreach ($entry in $Headers.GetEnumerator()) {
        [void]$request.Headers.TryAddWithoutValidation(
            $entry.Key,
            [string]$entry.Value
        )
    }
    if ($null -ne $Payload) {
        $json = $Payload | ConvertTo-Json -Depth 8 -Compress
        $request.Content = [System.Net.Http.StringContent]::new(
            $json,
            [Text.Encoding]::UTF8,
            "application/json"
        )
    }
    try {
        $response = $client.SendAsync($request).GetAwaiter().GetResult()
        $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return [pscustomobject]@{
            Response = $response
            Body = $body
        }
    }
    catch {
        Fail "request timed out or failed before an HTTP response was received."
    }
    finally {
        $request.Dispose()
    }
}

try {
    $health = SendJson "GET" "/v1/health" @{} $null
    if ([int]$health.Response.StatusCode -ne 200) {
        Fail "health returned HTTP $([int]$health.Response.StatusCode), expected 200."
    }
    if ($health.Response.Content.Headers.ContentType.MediaType -ne "application/json") {
        Fail "health Content-Type is not application/json."
    }
    $healthJson = $health.Body | ConvertFrom-Json
    if ($healthJson.status -ne "ok") {
        Fail "health response status is not ok."
    }
    Write-Output "PASS health"

    $payloadTypes = if ($PayloadType -eq "All") {
        @("iOS", "MacApp", "MacWebsite")
    } else {
        @($PayloadType)
    }

    foreach ($type in $payloadTypes) {
        $requestId = "req_smoke_$($type.ToLowerInvariant())_$([Guid]::NewGuid().ToString('N'))"
        $common = @{
            schema_version = "1.0"
            request_id = $requestId
            measured_at = "2026-07-24T04:00:00Z"
            platform = if ($type -eq "iOS") { "ios" } else { "macos" }
            app_switches_last_10_minutes = 2
            local_hour = 14
            minutes_since_last_rest = 180
            self_reported_energy = $null
            recent_feedback = @()
        }
        if ($type -eq "iOS") {
            $payload = $common + @{
                trigger_source = "device_activity_threshold"
                user_provided_context_label = "Smoke iOS"
                daily_app_usage_minutes = 35
                estimated_continuous_app_usage_minutes = 30
                continuous_usage_is_estimated = $true
                raw_app_names_included = $false
            }
        } elseif ($type -eq "MacApp") {
            $payload = $common + @{
                trigger_source = "macos_usage_checkpoint"
                user_provided_context_label = "Smoke Mac App"
                daily_app_usage_minutes = 35
                continuous_app_usage_minutes = 30
                continuous_usage_is_estimated = $false
                raw_app_names_included = $false
            }
        } else {
            $payload = $common + @{
                trigger_source = "macos_website_checkpoint"
                target_type = "website"
                website_domain = "example.com"
                label_source = "domain"
                daily_usage_minutes = 35
                continuous_usage_minutes = 30
                continuous_usage_is_estimated = $false
                full_url_included = $false
                page_title_included = $false
            }
        }

        $headers = @{
            "X-Request-ID" = $requestId
            "X-Client-Version" = "smoke-1.0.0"
            "X-Contract-Version" = "1.0"
        }
        if (-not [string]::IsNullOrEmpty($DemoToken)) {
            $headers["X-Hush-Demo-Token"] = $DemoToken
        }

        $result = SendJson "POST" "/v1/rest/evaluate" $headers $payload
        $status = [int]$result.Response.StatusCode
        if ($status -ne $ExpectedStatus) {
            Fail "$type returned HTTP $status, expected $ExpectedStatus."
        }
        if ($result.Response.Content.Headers.ContentType.MediaType -ne "application/json") {
            Fail "$type Content-Type is not application/json."
        }
        if ((HeaderValue $result.Response "X-Request-ID") -ne $requestId) {
            Fail "$type X-Request-ID does not echo the request."
        }
        if ((HeaderValue $result.Response "X-Contract-Version") -ne "1.0") {
            Fail "$type X-Contract-Version mismatch."
        }
        if ((HeaderValue $result.Response "X-Hush-Data-Origin") -ne $ExpectedDataOrigin) {
            Fail "$type X-Hush-Data-Origin mismatch."
        }

        $responseJson = $result.Body | ConvertFrom-Json
        if ($responseJson.request_id -ne $requestId) {
            Fail "$type response.request_id mismatch."
        }
        if ($ExpectedStatus -eq 200) {
            if ($responseJson.should_offer_rest -isnot [bool]) {
                Fail "$type should_offer_rest is not boolean."
            }
            if ($responseJson.message -isnot [string]) {
                Fail "$type message is not a string."
            }
        } elseif ($responseJson.error.message -isnot [string]) {
            Fail "$type error.message is not a string."
        }
        Write-Output "PASS $type HTTP $status origin $ExpectedDataOrigin"
    }

    Write-Output "PASS smoke summary: health plus $($payloadTypes.Count) payload type(s)"
}
finally {
    $client.Dispose()
}
