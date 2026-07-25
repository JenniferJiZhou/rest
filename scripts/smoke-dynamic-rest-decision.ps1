[CmdletBinding()]
param(
    [string]$BaseUrl,
    [ValidateSet("1.1")]
    [string]$ContractVersion = "1.1",
    [ValidateSet("real", "mock", "cached")]
    [string]$ExpectedDataOrigin = "mock",
    [ValidateRange(1, 120)]
    [int]$TimeoutSeconds = 40,
    [switch]$ExpectProviderUnavailable,
    [ValidateSet("All", "Offer", "Companion", "Manual")]
    [string]$FixtureMode = "All"
)

$ErrorActionPreference = "Stop"
$ClientVersion = "dynamic-rest-smoke-1.1"

function Fail([string]$Message) {
    Write-Error "FAIL: $Message"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    Fail "BaseUrl must be supplied explicitly; no network request was made."
}

$parsedBaseUrl = $null
if (-not [Uri]::TryCreate(
    $BaseUrl,
    [UriKind]::Absolute,
    [ref]$parsedBaseUrl
)) {
    Fail "BaseUrl must be an absolute URL."
}
if (-not [string]::IsNullOrEmpty($parsedBaseUrl.UserInfo)) {
    Fail "BaseUrl must not contain credentials."
}
if (-not [string]::IsNullOrEmpty($parsedBaseUrl.Query) -or
    -not [string]::IsNullOrEmpty($parsedBaseUrl.Fragment)) {
    Fail "BaseUrl must not contain a query or fragment."
}
if ($parsedBaseUrl.AbsolutePath -notin @("", "/")) {
    Fail "BaseUrl must not contain an application path."
}
if ($parsedBaseUrl.Scheme -eq "http" -and -not $parsedBaseUrl.IsLoopback) {
    Fail "Remote BaseUrl must use HTTPS."
}
if ($parsedBaseUrl.Scheme -notin @("http", "https")) {
    Fail "BaseUrl must use HTTPS, or HTTP only for loopback testing."
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

function AssertCommonResponse(
    [string]$Name,
    [string]$RequestId,
    $Result
) {
    if ($Result.Response.Content.Headers.ContentType.MediaType -ne
        "application/json") {
        Fail "$Name Content-Type is not application/json."
    }
    if ((HeaderValue $Result.Response "X-Request-ID") -ne $RequestId) {
        Fail "$Name X-Request-ID does not echo the request."
    }
    if ((HeaderValue $Result.Response "X-Contract-Version") -ne
        $ContractVersion) {
        Fail "$Name X-Contract-Version mismatch."
    }
    if ((HeaderValue $Result.Response "X-Hush-Data-Origin") -ne
        $ExpectedDataOrigin) {
        Fail "$Name X-Hush-Data-Origin mismatch."
    }

    $body = $Result.Body | ConvertFrom-Json
    if ($body.schema_version -ne $ContractVersion) {
        Fail "$Name body schema_version mismatch."
    }
    if ($body.request_id -ne $RequestId) {
        Fail "$Name body request_id mismatch."
    }
    return $body
}

function New-DynamicPayload(
    [string]$RequestId,
    [string]$Name
) {
    $offer = $Name -eq "Offer"
    return @{
        schema_version = "1.0"
        request_id = $RequestId
        measured_at = "2026-07-25T04:00:00Z"
        platform = "macos"
        trigger_source = "macos_usage_checkpoint"
        user_provided_context_label = "Smoke dynamic app"
        daily_app_usage_minutes = if ($offer) { 60 } else { 10 }
        continuous_app_usage_minutes = if ($offer) { 30 } else { 5 }
        continuous_usage_is_estimated = $false
        app_switches_last_10_minutes = if ($offer) { 4 } else { 1 }
        local_hour = 14
        minutes_since_last_rest = if ($offer) { 180 } else { 5 }
        self_reported_energy = $null
        recent_feedback = @()
        raw_app_names_included = $false
    }
}

function New-ManualPayload([string]$RequestId) {
    return @{
        schema_version = "1.1"
        request_id = $RequestId
        session_id = "session_dynamic_smoke_manual"
        fatigue_type = "cognitive_overload"
        user_preference = "quiet"
        available_minutes = 2
        source = "manual_macos"
        location_tags = @("desk")
    }
}

function AssertSuccessfulDecision(
    [string]$Name,
    $Body
) {
    if ($Body.should_offer_rest -isnot [bool]) {
        Fail "$Name should_offer_rest is not boolean."
    }
    if ($Body.message -isnot [string]) {
        Fail "$Name message is not a string."
    }
    if ($Body.PSObject.Properties.Name -notcontains "default_quest_id" -or
        $null -ne $Body.default_quest_id) {
        Fail "$Name default_quest_id must be present and null."
    }

    if ($Name -eq "Offer") {
        if (-not $Body.should_offer_rest) {
            Fail "Offer fixture did not return should_offer_rest=true."
        }
        if ($null -eq $Body.generated_task) {
            Fail "Offer generated_task must be an object."
        }
        if ([string]::IsNullOrWhiteSpace($Body.generated_task.title) -or
            $Body.generated_task.duration_seconds -isnot [int] -or
            @($Body.generated_task.steps).Count -eq 0) {
            Fail "Offer generated_task is incomplete."
        }
        $actions = @($Body.actions)
        if ($actions.Count -ne 3 -or
            $actions[0] -ne "start_rest_session" -or
            $actions[1] -ne "remind_later" -or
            $actions[2] -ne "dismiss") {
            Fail "Offer actions do not match Contract 1.1."
        }
        return
    }

    if ($Body.should_offer_rest) {
        Fail "Companion fixture did not return should_offer_rest=false."
    }
    if ($null -ne $Body.generated_task) {
        Fail "Companion generated_task must be null."
    }
    if ([string]::IsNullOrWhiteSpace($Body.message)) {
        Fail "Companion message must be non-empty."
    }
    if (@($Body.actions).Count -ne 0) {
        Fail "Companion actions must be empty."
    }
}

function AssertSuccessfulManualRest($Body) {
    if ($Body.PSObject.Properties.Name -contains "should_offer_rest") {
        Fail "Manual response must not contain should_offer_rest."
    }
    if ($Body.PSObject.Properties.Name -contains "quest_id") {
        Fail "Manual response must not contain quest_id."
    }
    if ($null -eq $Body.generated_task -or
        [string]::IsNullOrWhiteSpace($Body.generated_task.title) -or
        $Body.generated_task.duration_seconds -isnot [int] -or
        @($Body.generated_task.steps).Count -eq 0) {
        Fail "Manual generated_task is incomplete."
    }
    if ($Body.PSObject.Properties.Name -notcontains "default_quest_id" -or
        $null -ne $Body.default_quest_id) {
        Fail "Manual default_quest_id must be present and null."
    }
    $actions = @($Body.actions)
    if ($actions.Count -ne 3 -or
        $actions[0] -ne "start_rest_session" -or
        $actions[1] -ne "remind_later" -or
        $actions[2] -ne "dismiss") {
        Fail "Manual actions do not match Contract 1.1."
    }
}

try {
    $health = SendJson "GET" "/v1/health" @{} $null
    if ([int]$health.Response.StatusCode -ne 200) {
        Fail "health returned HTTP $([int]$health.Response.StatusCode)."
    }
    if ($health.Response.Content.Headers.ContentType.MediaType -ne
        "application/json") {
        Fail "health Content-Type is not application/json."
    }
    $healthBody = $health.Body | ConvertFrom-Json
    if ($healthBody.status -ne "ok" -or
        $healthBody.contract_version -ne "1.0") {
        Fail "health response does not match the liveness contract."
    }
    $expectedHealth = if ($ExpectProviderUnavailable) {
        "unavailable"
    } else {
        "ready"
    }
    if ($healthBody.providers.rest_decision -ne $expectedHealth) {
        Fail "health rest_decision state mismatch."
    }
    Write-Output "PASS health"

    $fixtures = if ($FixtureMode -eq "All") {
        @("Offer", "Companion", "Manual")
    } else {
        @($FixtureMode)
    }

    foreach ($name in $fixtures) {
        $requestId =
            "req_dynamic_smoke_$($name.ToLowerInvariant())_$(
                [Guid]::NewGuid().ToString("N")
            )"
        $headers = @{
            "X-Request-ID" = $requestId
            "X-Client-Version" = $ClientVersion
            "X-Contract-Version" = $ContractVersion
        }
        $path = if ($name -eq "Manual") {
            "/v1/rest/recommend"
        } else {
            "/v1/rest/evaluate"
        }
        $payload = if ($name -eq "Manual") {
            New-ManualPayload $requestId
        } else {
            New-DynamicPayload $requestId $name
        }
        $result = SendJson "POST" $path $headers $payload
        $status = [int]$result.Response.StatusCode
        $expectedStatus = if ($ExpectProviderUnavailable) { 503 } else { 200 }
        if ($status -ne $expectedStatus) {
            Fail "$name returned HTTP $status, expected $expectedStatus."
        }
        $body = AssertCommonResponse $name $requestId $result

        if ($ExpectProviderUnavailable) {
            if ($null -eq $body.error -or
                [string]::IsNullOrWhiteSpace($body.error.code)) {
                Fail "$name 503 response is missing an ErrorResponse."
            }
            if ($body.PSObject.Properties.Name -contains
                "should_offer_rest") {
                Fail "$name 503 response contains a success payload."
            }
        } else {
            if ($name -eq "Manual") {
                AssertSuccessfulManualRest $body
            } else {
                AssertSuccessfulDecision $name $body
            }
        }
        Write-Output "PASS $name HTTP $status origin $ExpectedDataOrigin"
    }

    Write-Output (
        "PASS dynamic rest decision smoke summary: health plus " +
        "$($fixtures.Count) Contract 1.1 fixture(s)"
    )
}
finally {
    $client.Dispose()
}
