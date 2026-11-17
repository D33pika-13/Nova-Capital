@export()
@sealed()
type ImmutableImage = {
  repository: string
  @minLength(64)
  @maxLength(64)
  sha256: string
}
